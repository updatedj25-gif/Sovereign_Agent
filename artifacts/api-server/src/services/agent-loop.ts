import { db, commandsTable, taskGroupsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
import { getToolDefinitions, executeTool, ToolResult, AgentContext } from "../tools/registry";
import { sandboxService } from "./sandbox";
import { hitlGateService } from "./hitl-gate";
import * as path from "node:path";

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
    thought: "AI service unavailable — simulation step completed.",
    subtasks: ["Execute default task"],
    tool: null,
    args: {},
    finish: true,
    final_response: "Agent loop completed fallback simulation.",
  });
}

function isCommandDangerous(command: string): boolean {
  if (!command || typeof command !== "string") return false;
  const cmd = command.trim();
  const dangerousPatterns = [
    /\brm\s+-[rRfF]/i,
    /rm\s+-[rRfF]+\s+[\/*]/i,
    /\bsudo\b/i,
    /\bchmod\b/i,
    /\bchown\b/i,
    /git\s+push\s+.*--force/i,
    /git\s+push\s+.*-f\b/i,
    /drop\s+database/i,
    /drop\s+table/i,
    />\s*\.env/i,
    /export\s+[A-Za-z0-9_]*SECRET/i,
    /export\s+[A-Za-z0-9_]*KEY/i,
    /\bcurl\b/i,
    /\bwget\b/i,
  ];
  return dangerousPatterns.some((pattern) => pattern.test(cmd));
}

function isPathSensitive(filePath: string): boolean {
  if (!filePath || typeof filePath !== "string") return false;
  const baseName = path.basename(filePath).toLowerCase();
  const sensitiveFiles = [
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    "package.json",
    "wrangler.toml",
    "dockerfile",
    "docker-compose.yml",
    "tsconfig.json",
    "firebase.json",
    "firestore.rules",
  ];
  return sensitiveFiles.includes(baseName) || baseName.startsWith(".env");
}

export interface AgentLoopOptions {
  prompt: string;
  history?: Array<{ role: string; content: string }>;
  workspaceGroupId: string;
  dbTaskGroupId?: number | null;
  maxTurns?: number;
  onEvent: (event: any) => void;
  signal?: AbortSignal;
}

export interface AgentLoopResult {
  success: boolean;
  finalResponse: string;
  turns: number;
}

export class AgentLoop {
  private defaultMaxTurns: number;

  constructor(defaultMaxTurns: number = 20) {
    this.defaultMaxTurns = defaultMaxTurns;
  }

  async run(options: AgentLoopOptions): Promise<AgentLoopResult> {
    const {
      prompt,
      history = [],
      workspaceGroupId,
      dbTaskGroupId,
      onEvent,
      signal,
    } = options;

    const maxTurns = options.maxTurns || this.defaultMaxTurns;
    const toolDefs = getToolDefinitions();

    const systemPrompt = `You are Sovereign, an autonomous event-driven AI coding agent operating in an Observe -> Plan -> Execute -> Evaluate loop.

Available Tools:
${JSON.stringify(toolDefs, null, 2)}

RESPONSE FORMAT INSTRUCTIONS:
On EVERY turn, reply with a single valid JSON object strictly conforming to this schema:
{
  "thought": "Step-by-step reasoning about observations, state, and actions to take",
  "subtasks": ["subtask 1", "subtask 2"], // Optional array of planned subtasks on the first turn
  "tool": "tool_name" | null, // Must match a tool from Available Tools (e.g. "execute_terminal_cmd", "read_file", "write_file", "edit_file_diff", "list_directory", "grep_search", "git_commit")
  "args": { ...arguments required by the selected tool... },
  "finish": boolean, // Set to true when the user prompt objective is fully satisfied
  "final_response": "Detailed markdown explanation for the user when finish is true, else null"
}

RULES:
1. To execute actions or gather information, pick a tool, set "finish": false, and provide "args".
2. When the user prompt objective is fulfilled, set "finish": true, "tool": null, and provide "final_response".
3. Output ONLY the JSON object. Do not wrap in extra markdown or plain text outside the JSON structure.
4. Inspect files before modifying them. Fix any errors encountered during tool execution.`;

    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: prompt },
    ];

    let turnsCount = 0;
    let finalResponse = "";
    let roadmapEmitted = false;

    const workspaceRoot = path.join("/tmp/sovereign-workspaces", workspaceGroupId);
    const agentContext: AgentContext = {
      taskGroupId: String(dbTaskGroupId || workspaceGroupId),
      workspaceRoot,
    };

    try {
      onEvent({
        type: "analysis_started",
        title: "Autonomous Agent Loop started (Observe -> Plan -> Execute -> Evaluate)...",
      });

      while (turnsCount < maxTurns) {
        turnsCount++;

        // Step 1: Observe & Plan (Send state memory to LLM)
        let rawResponse = "";
        try {
          rawResponse = await callAIModel(messages, signal);
        } catch (err: any) {
          const errMsg = `AI model invocation failed: ${err.message || String(err)}`;
          onEvent({ type: "error", message: errMsg });
          onEvent({
            type: "stream_finished",
            taskGroupId: dbTaskGroupId,
            status: "failed",
            finalResponse: errMsg,
          });
          return { success: false, finalResponse: errMsg, turns: turnsCount };
        }

        // Parse LLM Output
        let turnData: {
          thought?: string;
          subtasks?: string[];
          tool?: string | null;
          args?: Record<string, any>;
          params?: Record<string, any>;
          finish?: boolean;
          final_response?: string | null;
        } | null = null;

        try {
          const cleaned = rawResponse.replace(/```json|```/g, "").trim();
          turnData = JSON.parse(cleaned);
        } catch {
          const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              turnData = JSON.parse(jsonMatch[0]);
            } catch {
              /* Ignore parse error */
            }
          }
        }

        if (!turnData) {
          turnData = {
            thought: "Direct response generated.",
            tool: null,
            args: {},
            finish: true,
            final_response: rawResponse,
          };
        }

        // Emit roadmap_ready event if subtasks planned
        if (!roadmapEmitted) {
          const subtasks = Array.isArray(turnData.subtasks) && turnData.subtasks.length > 0
            ? turnData.subtasks.map(String)
            : [prompt.slice(0, 100)];

          onEvent({
            type: "roadmap_ready",
            subtasks,
            taskGroupId: dbTaskGroupId,
          });
          roadmapEmitted = true;
        }

        // Emit thought
        if (turnData.thought) {
          onEvent({
            type: "agent_thought",
            thought: turnData.thought,
            turn: turnsCount,
          });
        }

        // Check if objective is fulfilled
        if (turnData.finish || !turnData.tool) {
          finalResponse = turnData.final_response || turnData.thought || "Task completed successfully.";
          onEvent({
            type: "stream_finished",
            taskGroupId: dbTaskGroupId,
            status: "success",
            finalResponse,
            turns: turnsCount,
          });
          return { success: true, finalResponse, turns: turnsCount };
        }

        // Normalize tool name and args
        let toolName = turnData.tool;
        let toolArgs = turnData.args || turnData.params || {};

        // Alias resolution
        if (toolName === "execute_bash" || toolName === "bash" || toolName === "shell") {
          toolName = "execute_terminal_cmd";
          toolArgs = { command: toolArgs.command || toolArgs.cmd || "" };
        } else if (toolName === "list_dir" || toolName === "directory_list") {
          toolName = "list_directory";
          toolArgs = { path: toolArgs.path || toolArgs.directoryPath || "." };
        } else if (toolName === "replace_string" || toolName === "edit_file") {
          toolName = "edit_file_diff";
          toolArgs = {
            path: toolArgs.path || toolArgs.filePath || "",
            search_block: toolArgs.old_str || toolArgs.oldStr || toolArgs.search_block || "",
            replace_block: toolArgs.new_str || toolArgs.newStr || toolArgs.replace_block || "",
          };
        }

        const commandDisplay = toolName === "execute_terminal_cmd"
          ? String(toolArgs.command || toolName)
          : `${toolName}(${JSON.stringify(toolArgs)})`;

        onEvent({
          type: "task_running",
          task: commandDisplay,
          taskId: turnsCount,
          index: turnsCount,
          command: commandDisplay,
          tool: toolName,
          log: `▶ Executing: ${commandDisplay}\n`,
        });

        onEvent({
          type: "tool_started",
          tool: toolName,
          params: toolArgs,
          turn: turnsCount,
        });

        // Step 2: Execute (Check HITL + Execute Tool)
        let isDangerous = false;
        let dangerReason = "";
        if (toolName === "execute_terminal_cmd" && isCommandDangerous(String(toolArgs.command || ""))) {
          isDangerous = true;
          dangerReason = `Dangerous shell command detected: '${toolArgs.command}'`;
        } else if (isPathSensitive(String(toolArgs.path || ""))) {
          isDangerous = true;
          dangerReason = `Modifying sensitive configuration file: '${toolArgs.path}'`;
        }

        if (isDangerous) {
          const { approvalId, approvedPromise } = await hitlGateService.requestApproval(
            workspaceGroupId,
            toolName,
            toolArgs,
            dangerReason
          );

          onEvent({
            type: "hitl_approval_required",
            approvalId,
            toolName,
            params: toolArgs,
            dangerReason,
          });

          const isApproved = await approvedPromise;

          if (!isApproved) {
            onEvent({
              type: "hitl_rejected",
              approvalId,
              toolName,
              reason: "Action rejected by human approval gate.",
            });

            const rejectionMsg = "Command execution rejected by user approval gate.";
            onEvent({
              type: "task_completed",
              taskId: turnsCount,
              index: turnsCount,
              exitCode: 1,
              log: `\n✗ Execution rejected by HITL gate: ${commandDisplay}\n`,
            });

            if (dbTaskGroupId) {
              try {
                await db.insert(commandsTable).values({
                  taskGroupId: dbTaskGroupId,
                  cmd: commandDisplay,
                  exitCode: 1,
                  stdout: "",
                  stderr: rejectionMsg,
                });
              } catch {
                /* Non-fatal DB write error */
              }
            }

            // Record rejection in memory scratchpad
            messages.push({ role: "assistant", content: JSON.stringify(turnData) });
            messages.push({
              role: "user",
              content: `Observation from ${toolName}: [REJECTED BY USER GATE] ${rejectionMsg}`,
            });
            continue;
          }

          onEvent({
            type: "hitl_approved",
            approvalId,
            toolName,
          });
        }

        // Execute Tool via registry or sandboxService streaming
        let executionResult: ToolResult;
        let stdoutAcc = "";
        let stderrAcc = "";

        if (toolName === "execute_terminal_cmd") {
          const cmdToRun = String(toolArgs.command || "");
          const timeoutMs = Number(toolArgs.timeout_ms) || 120000;

          const res = await sandboxService.executeCommand(
            workspaceGroupId,
            cmdToRun,
            (chunk) => {
              stdoutAcc += chunk;
              onEvent({
                type: "task_progress",
                chunk,
                taskId: turnsCount,
                index: turnsCount,
                stdout: chunk,
                log: chunk,
                tool: toolName,
              });
            },
            (chunk) => {
              stderrAcc += chunk;
              onEvent({
                type: "task_progress",
                chunk,
                taskId: turnsCount,
                index: turnsCount,
                stderr: chunk,
                log: chunk,
                tool: toolName,
              });
            },
            timeoutMs
          );

          const combinedOut = [stdoutAcc, stderrAcc].filter(Boolean).join("\n").trim();
          executionResult = {
            success: res.exitCode === 0,
            output: combinedOut || `Command completed with exit code ${res.exitCode}`,
            error: res.exitCode !== 0 ? stderrAcc.trim() || `Exit code ${res.exitCode}` : undefined,
            metadata: { exitCode: res.exitCode },
          };
        } else {
          executionResult = await executeTool(toolName, toolArgs, agentContext);

          const outChunk = executionResult.output || executionResult.error || "";
          if (outChunk) {
            onEvent({
              type: "task_progress",
              chunk: outChunk,
              taskId: turnsCount,
              index: turnsCount,
              stdout: executionResult.output,
              stderr: executionResult.error,
              log: outChunk,
              tool: toolName,
            });
          }
        }

        const exitCode = executionResult.success ? 0 : (executionResult.metadata?.exitCode ?? 1);

        onEvent({
          type: "task_completed",
          summary: executionResult.success
            ? `${toolName} completed successfully.`
            : `${toolName} failed with exit code ${exitCode}.`,
          taskId: turnsCount,
          index: turnsCount,
          exitCode,
          log: executionResult.success
            ? `\n✓ ${toolName} completed successfully (exit code ${exitCode})\n`
            : `\n✗ ${toolName} failed (exit code ${exitCode})\n`,
        });

        onEvent({
          type: "tool_completed",
          tool: toolName,
          output: executionResult.output || executionResult.error || "",
          exitCode,
          turn: turnsCount,
        });

        if (toolName === "request_env_vars") {
          onEvent({
            type: "env_vars_requested",
            stage: toolArgs.stage || "initial_setup",
            sourceCategory: toolArgs.sourceCategory,
            keys: Array.isArray(toolArgs.keys) ? toolArgs.keys : [],
            deploymentTarget: toolArgs.deploymentTarget,
            reason: toolArgs.reason,
          });
        }

        // Write DB log into commands table
        if (dbTaskGroupId) {
          try {
            await db.insert(commandsTable).values({
              taskGroupId: dbTaskGroupId,
              cmd: commandDisplay,
              exitCode,
              stdout: stdoutAcc || executionResult.output || "",
              stderr: stderrAcc || executionResult.error || "",
            });
          } catch {
            /* non-fatal */
          }
        }

        // Step 3: Evaluate (Update state memory with tool results)
        messages.push({
          role: "assistant",
          content: JSON.stringify(turnData),
        });

        const observationStr = executionResult.success
          ? `Observation from ${toolName}:\n${executionResult.output}`
          : `Observation from ${toolName} [ERROR]:\n${executionResult.error || executionResult.output}`;

        messages.push({
          role: "user",
          content: observationStr,
        });
      }

      // Max turns reached safety termination
      const maxTurnErr = `Maximum iteration limit reached (${maxTurns} turns). Agent loop terminated safely.`;
      onEvent({ type: "error", message: maxTurnErr });
      onEvent({
        type: "stream_finished",
        taskGroupId: dbTaskGroupId,
        status: "failed",
        finalResponse: maxTurnErr,
      });

      return { success: false, finalResponse: maxTurnErr, turns: maxTurns };
    } catch (err: any) {
      const errMsg = err?.message || "Unhandled error in Autonomous Agent Loop";
      onEvent({ type: "error", message: errMsg });
      onEvent({
        type: "stream_finished",
        taskGroupId: dbTaskGroupId,
        status: "failed",
        finalResponse: errMsg,
      });
      return { success: false, finalResponse: errMsg, turns: turnsCount };
    }
  }
}

export const agentLoop = new AgentLoop();
