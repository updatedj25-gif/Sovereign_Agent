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
        content: `You are an Autonomous ReAct Coding Agent.
Available Tools:
${JSON.stringify(AGENT_TOOLS, null, 2)}

To call a tool, respond ONLY with a JSON block:
{
  "thought": "Reasoning for the next action",
  "tool": "tool_name",
  "args": { ... }
}

If task is finished, respond:
{
  "thought": "All requirements satisfied",
  "tool": "final_response",
  "args": { "summary": "Task complete summary" }
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
    return {
      thought: "Dry run mode",
      tool: "final_response",
      args: { summary: "Execution completed in sandbox." },
    };
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages }),
    }
  );

  const json = await res.json();
  const content = json.result?.response || "{}";

  try {
    const match = content.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : "{}");
  } catch {
    return {
      thought: "Fallback execution",
      tool: "final_response",
      args: { summary: "Completed" },
    };
  }
}