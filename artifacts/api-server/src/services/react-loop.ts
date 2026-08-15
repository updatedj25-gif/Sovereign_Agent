import { db, taskGroups, commands } from "@workspace/db";
import { eq } from "drizzle-orm";
import { AGENT_TOOLS, ToolExecutionHandler } from "./agent-tools";
import { ReviewerAgent } from "./reviewer-agent";

export interface ReActLoopOptions {
  taskGroupId: number;
  sessionId: string;
  userPrompt: string;
  maxTurns?: number;
  sendSSE: (eventData: object) => void;
}

export class AutonomousReActEngine {
  /**
   * Main Autonomous Loop: Runs tool calls, recovers from errors, and executes reflection pass.
   */
  public static async runLoop(options: ReActLoopOptions): Promise<boolean> {
    const { taskGroupId, sessionId, userPrompt, maxTurns = 10, sendSSE } = options;

    await db
      .update(taskGroups)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(taskGroups.id, taskGroupId));

    const conversationHistory: Array<{ role: string; content: string }> = [
      {
        role: "system",
        content: `You are Sovereign Agent, a high-autonomy full-stack autonomous coding agent.

Available Tools:
${JSON.stringify(AGENT_TOOLS, null, 2)}

Instructions:
1. Always solve the user's objective by executing the necessary tools step-by-step.
2. For creating folders/directories: use "create_directory" with {"path": "folder_path"}.
3. For creating/writing files: use "write_file" with {"filePath": "...", "content": "..."}.
4. For reading files: use "read_file" with {"filePath": "..."}.
5. For executing bash/build/test commands: use "exec_bash" with {"command": "..."}.
6. For editing files with search/replace: use "apply_diff" with {"diffResponse": "..."}.
7. When all requirements are satisfied or complete, respond with "final_response".

RESPONSE FORMAT:
You MUST respond with a JSON object in this exact schema:
{
  "thought": "Clear explanation of what you are doing and why",
  "tool": "create_directory | write_file | read_file | delete_file | list_directory | exec_bash | apply_diff | search_code | git_diff | final_response",
  "args": { ... }
}`,
      },
      { role: "user", content: userPrompt },
    ];

    let currentTurn = 0;
    let completed = false;

    while (currentTurn < maxTurns && !completed) {
      currentTurn++;
      console.log(`[ReAct Loop] Turn ${currentTurn}/${maxTurns} for session: ${sessionId}`);

      // 1. Query LLM for next Action/Tool call
      const llmAction = await callLLM(conversationHistory);

      if (!llmAction || !llmAction.tool) {
        sendSSE({ type: "error", message: "Failed to parse tool call from LLM." });
        break;
      }

      sendSSE({
        type: "task_running",
        task: `Turn ${currentTurn}: ${llmAction.thought}`,
        tool: llmAction.tool,
      });

      // 2. Handle Completion Signal
      if (llmAction.tool === "final_response") {
        completed = true;
        break;
      }

      // 3. Execute Tool Action
      const toolResult = await ToolExecutionHandler.execute(
        sessionId,
        llmAction.tool,
        llmAction.args || {}
      );

      // Record command history in PostgreSQL
      await db.insert(commands).values({
        taskGroupId,
        cmd: `${llmAction.tool}(${JSON.stringify(llmAction.args)})`,
        exitCode: toolResult.success ? 0 : 1,
        stdout: toolResult.output,
        stderr: toolResult.success ? "" : toolResult.output,
        createdAt: new Date(),
      });

      // Stream progress SSE
      sendSSE({
        type: "task_progress",
        tool: llmAction.tool,
        success: toolResult.success,
        output: toolResult.output.substring(0, 1000), // Trim SSE payload
      });

      // 4. Observe Output & Append to Conversation History
      conversationHistory.push({
        role: "assistant",
        content: JSON.stringify(llmAction),
      });

      // 5. Dynamic Re-planning on Failure
      if (!toolResult.success) {
        conversationHistory.push({
          role: "user",
          content: `OBSERVATION (FAILURE):\nTool '${llmAction.tool}' failed with output:\n${toolResult.output}\n\nPlease inspect this error, re-plan your strategy, and try a corrected tool action.`,
        });
      } else {
        conversationHistory.push({
          role: "user",
          content: `OBSERVATION (SUCCESS):\n${toolResult.output}`,
        });
      }
    }

    // 6. Reflection & Critique Step before declaring SUCCESS
    sendSSE({ type: "reflection_started", message: "Running Reviewer & Reflection Pass..." });
    const reviewResult = await ReviewerAgent.evaluateTask(sessionId, userPrompt);

    const isFinalSuccess = completed && reviewResult.approved;
    const finalStatus = isFinalSuccess ? "success" : "failed";

    await db
      .update(taskGroups)
      .set({
        status: finalStatus,
        summary: reviewResult.summary,
        updatedAt: new Date(),
      })
      .where(eq(taskGroups.id, taskGroupId));

    sendSSE({
      type: "task_completed",
      status: finalStatus,
      review: reviewResult,
    });

    return isFinalSuccess;
  }
}

async function callLLM(messages: any[]): Promise<{ thought: string; tool: string; args: any }> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiKey = process.env.CLOUDFLARE_API_KEY;

  if (!accountId || !apiKey) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    if (/folder|dir|mkdir/i.test(lastUser)) {
      const folderName = lastUser.replace(/.*(folder|dir|directory)\s+/i, "").trim() || "new-folder";
      return {
        thought: `Creating folder '${folderName}' in sandbox`,
        tool: "create_directory",
        args: { path: folderName },
      };
    }
    return {
      thought: "Executed in local environment sandbox",
      tool: "final_response",
      args: { summary: "Execution completed in sandbox." },
    };
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages, temperature: 0.1 }),
      }
    );

    const json = (await res.json()) as any;
    const content = json.result?.response || (typeof json.result === "string" ? json.result : "");

    // 1. Try extracting json code block
    const codeBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1]);
        if (parsed.tool || parsed.thought) return parsed;
      } catch {}
    }

    // 2. Try extracting general JSON object
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed.tool || parsed.thought) return parsed;
      } catch {}
    }

    // 3. Fallback: Parse natural language intent if LLM replied without strict JSON
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    if (/create\s+(a\s+)?(folder|dir|directory)/i.test(lastUser) || /create\s+(a\s+)?(folder|dir|directory)/i.test(content)) {
      const matchName = lastUser.match(/create\s+(?:a\s+)?(?:folder|dir|directory)\s+(?:named\s+|called\s+)?(["']?)([\w\-\/\.]+)\1/i);
      const folderName = matchName ? matchName[2] : "new-folder";
      return {
        thought: `Creating folder '${folderName}' in sandbox workspace`,
        tool: "create_directory",
        args: { path: folderName },
      };
    }

    return {
      thought: content || "Completed task reasoning",
      tool: "final_response",
      args: { summary: content || "Task completed." },
    };
  } catch (err: any) {
    return {
      thought: `Error calling Cloudflare AI: ${err.message}`,
      tool: "final_response",
      args: { summary: `Error: ${err.message}` },
    };
  }
}