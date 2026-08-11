import { db, commandsTable, taskGroupsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
import { toolRegistry } from "./tools";
import { hitlGateService } from "../services/hitl-gate";
import { sandboxService } from "../services/sandbox";

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_KEY = process.env.CLOUDFLARE_API_KEY;
const CLOUDFLARE_EMAIL = process.env.CLOUDFLARE_EMAIL;
const CLOUDFLARE_AI_MODEL =
  process.env.CLOUDFLARE_AI_MODEL ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

let geminiClient: GoogleGenAI | null = null;
function getGemini() {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return geminiClient;
}

export async function callAIModel(
  messages: Array<{ role: string; content: string }>,
  signal?: AbortSignal
): Promise<string> {
  if (CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_API_KEY && CLOUDFLARE_EMAIL) {
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${CLOUDFLARE_AI_MODEL}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Auth-Email": CLOUDFLARE_EMAIL,
            "X-Auth-Key": CLOUDFLARE_API_KEY,
          },
          body: JSON.stringify({ messages }),
          signal,
        }
      );
      if (res.ok) {
        const data = (await res.json()) as { result?: { response?: string }; response?: string };
        const text = data?.result?.response ?? (data as { response?: string })?.response;
        if (text) return text;
      }
    } catch {
      /* Fallback to Gemini below */
    }
  }

  const gemini = getGemini();
  if (gemini) {
    const sysMsg = messages.find((m) => m.role === "system")?.content;
    const userPrompt = messages
      .filter((m) => m.role !== "system")
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n");
    const response = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: userPrompt || "Hello",
      config: sysMsg ? { systemInstruction: sysMsg } : undefined,
    });
    return response.text ?? "";
  }

  return JSON.stringify({
    thought: "Simulated execution completed.",
    tool: null,
    params: {},
    finish: true,
    final_response: "Simulated agent execution completed successfully.",
  });
}

export interface ReActEngineOptions {
  prompt: string;
  history?: Array<{ role: string; content: string }>;
  workspaceGroupId: string;
  dbTaskGroupId?: number | null;
  maxTurns?: number;
  onEvent: (event: any) => void;
  signal?: AbortSignal;
}

export interface ReActTurnOutput {
  thought: string;
  tool: string | null;
  params: Record<string, any>;
  finish: boolean;
  final_response: string | null;
}

export class ReActEngine {
  private defaultMaxTurns: number;

  constructor(defaultMaxTurns: number = 15) {
    this.defaultMaxTurns = defaultMaxTurns;
  }

  async run(options: ReActEngineOptions): Promise<{ finalResponse: string; success: boolean }> {
    const {
      prompt,
      history = [],
      workspaceGroupId,
      dbTaskGroupId,
      onEvent,
      signal,
    } = options;

    const maxTurns = options.maxTurns || this.defaultMaxTurns;
    const toolsSchema = toolRegistry.getToolDefinitionsForLLM();

    const systemPrompt = `You are Sovereign, an autonomous full-stack coding agent.
You operate in a ReAct (Reasoning + Acting) loop to solve software tasks iteratively.

Available Tools:
${JSON.stringify(toolsSchema, null, 2)}

CRITICAL RESPONSE FORMAT INSTRUCTIONS:
On EVERY turn, you MUST reply with a single valid JSON object strictly matching this schema:
{
  "thought": "Your reasoning about what to do next or summary of progress",
  "tool": "name_of_tool_to_call" | null,
  "params": { ...parameters object for tool... },
  "finish": boolean (true when task is fully completed, false if more actions needed),
  "final_response": "Detailed text response for user when finish is true, otherwise null"
}

RULES:
1. If you need information or need to make a workspace change, select a tool, set "finish": false, "final_response": null.
2. If the user task is done, set "finish": true, "tool": null, and provide "final_response".
3. Output ONLY the JSON object. Do not include extra text outside the JSON.
4. Always inspect files and workspace before making assumptions.
5. Fix any errors encountered in tool execution.`;

    const contextMessages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: prompt },
    ];

    let turnsCount = 0;
    let finalResponse = "";
    let success = true;

    while (turnsCount < maxTurns) {
      turnsCount++;

      // Step 1: Thought Generation
      let rawAiResponse = "";
      try {
        rawAiResponse = await callAIModel(contextMessages, signal);
      } catch (err: any) {
        onEvent({ type: "error", message: `AI model invocation error: ${err.message || String(err)}` });
        success = false;
        break;
      }

      // Parse JSON response
      let turnOutput: ReActTurnOutput | null = null;
      try {
        const cleaned = rawAiResponse.replace(/```json|```/g, "").trim();
        turnOutput = JSON.parse(cleaned);
      } catch {
        const jsonMatch = rawAiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            turnOutput = JSON.parse(jsonMatch[0]);
          } catch {
            /* ignore parse failure */
          }
        }
      }

      if (!turnOutput) {
        turnOutput = {
          thought: "Direct response generated.",
          tool: null,
          params: {},
          finish: true,
          final_response: rawAiResponse,
        };
      }

      // Emit thought event
      if (turnOutput.thought) {
        onEvent({
          type: "agent_thought",
          thought: turnOutput.thought,
          turn: turnsCount,
        });
      }

      // Check for completion
      if (turnOutput.finish || !turnOutput.tool) {
        finalResponse = turnOutput.final_response || turnOutput.thought || "Task completed successfully.";
        onEvent({
          type: "stream_finished",
          finalResponse,
          status: "success",
          taskGroupId: dbTaskGroupId,
          turns: turnsCount,
        });
        return { finalResponse, success: true };
      }

      // Step 2: Tool Invocation & HITL Check
      const toolName = turnOutput.tool;
      const toolParams = turnOutput.params || {};

      onEvent({
        type: "tool_started",
        tool: toolName,
        params: toolParams,
        turn: turnsCount,
      });

      // Check if tool is dangerous
      const isDangerous = toolRegistry.isToolDangerous(toolName, toolParams);
      let isApproved = true;

      if (isDangerous) {
        const dangerReason = `Dangerous tool call detected for '${toolName}': ${JSON.stringify(toolParams)}`;

        const { approvalId, approvedPromise } = await hitlGateService.requestApproval(
          workspaceGroupId,
          toolName,
          toolParams,
          dangerReason
        );

        onEvent({
          type: "hitl_approval_required",
          approvalId,
          toolName,
          params: toolParams,
          dangerReason,
        });

        isApproved = await approvedPromise;

        if (!isApproved) {
          onEvent({
            type: "hitl_rejected",
            approvalId,
            toolName,
            reason: "Action rejected by human operator.",
          });

          const rejectionOutput = "Execution halted: Tool call rejected by user via HITL approval gate.";
          onEvent({
            type: "tool_completed",
            tool: toolName,
            output: rejectionOutput,
            exitCode: 1,
            turn: turnsCount,
          });

          if (dbTaskGroupId) {
            try {
              await db.insert(commandsTable).values({
                taskGroupId: dbTaskGroupId,
                cmd: `${toolName}: ${JSON.stringify(toolParams)}`,
                exitCode: 1,
                stdout: "",
                stderr: rejectionOutput,
              });
            } catch {
              /* ignore db err */
            }
          }

          contextMessages.push({
            role: "assistant",
            content: JSON.stringify(turnOutput),
          });
          contextMessages.push({
            role: "user",
            content: `Observation from ${toolName}: [REJECTED BY USER] ${rejectionOutput}`,
          });
          continue;
        }

        onEvent({
          type: "hitl_approved",
          approvalId,
          toolName,
        });
      }

      // Step 3: Execute Tool
      let executionResult: { success: boolean; output: string; error?: string };

      if (toolName === "execute_bash" || toolName === "bash") {
        const cmd = toolParams.command || toolParams.cmd || "";
        let stdoutAcc = "";
        let stderrAcc = "";

        const res = await sandboxService.executeCommand(
          workspaceGroupId,
          cmd,
          (chunk) => {
            stdoutAcc += chunk;
            onEvent({
              type: "task_progress",
              stdout: chunk,
              log: chunk,
              tool: toolName,
            });
          },
          (chunk) => {
            stderrAcc += chunk;
            onEvent({
              type: "task_progress",
              stderr: chunk,
              log: chunk,
              tool: toolName,
            });
          }
        );

        const combined = [stdoutAcc, stderrAcc].filter(Boolean).join("\n").trim();
        executionResult = {
          success: res.exitCode === 0,
          output: combined || `Command finished with exit code ${res.exitCode}`,
          error: res.exitCode !== 0 ? stderrAcc.trim() || `Exit code ${res.exitCode}` : undefined,
        };

        if (dbTaskGroupId) {
          try {
            await db.insert(commandsTable).values({
              taskGroupId: dbTaskGroupId,
              cmd,
              exitCode: res.exitCode,
              stdout: stdoutAcc,
              stderr: stderrAcc,
            });
          } catch {
            /* ignore db err */
          }
        }
      } else {
        executionResult = await toolRegistry.executeTool(toolName, workspaceGroupId, toolParams);

        if (dbTaskGroupId) {
          try {
            await db.insert(commandsTable).values({
              taskGroupId: dbTaskGroupId,
              cmd: `${toolName}(${JSON.stringify(toolParams)})`,
              exitCode: executionResult.success ? 0 : 1,
              stdout: executionResult.output,
              stderr: executionResult.error || "",
            });
          } catch {
            /* ignore db err */
          }
        }
      }

      onEvent({
        type: "tool_completed",
        tool: toolName,
        output: executionResult.output || executionResult.error || "",
        exitCode: executionResult.success ? 0 : 1,
        turn: turnsCount,
      });

      // Step 4: Re-evaluation Loop Context Update
      contextMessages.push({
        role: "assistant",
        content: JSON.stringify(turnOutput),
      });

      const observationStr = executionResult.success
        ? `Observation from ${toolName}:\n${executionResult.output}`
        : `Observation from ${toolName} [ERROR]:\n${executionResult.error || executionResult.output}`;

      contextMessages.push({
        role: "user",
        content: observationStr,
      });
    }

    finalResponse = `Agent reached maximum turns limit (${maxTurns}). Partial task steps completed.`;
    onEvent({
      type: "stream_finished",
      finalResponse,
      status: "finished",
      taskGroupId: dbTaskGroupId,
      turns: turnsCount,
    });

    return { finalResponse, success };
  }
}

export const reactEngine = new ReActEngine();
