import { Response } from "express";
import { AGENT_TOOLS, ToolDispatcher } from "./tools";

export interface ReActMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export class ReActEngine {
  private static MAX_TURNS = 12;

  /**
   * Executes the full ReAct loop, calling LLM, running tools, verifying errors, and streaming progress.
   */
  static async runLoop(
    userPrompt: string,
    res: Response,
    dbTaskGroupId: number
  ): Promise<void> {
    const sendSSE = (data: Record<string, any>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const messages: ReActMessage[] = [
      {
        role: "system",
        content: `You are Sovereign Agent, an autonomous full-stack software engineer.
You solve coding problems iteratively:
1. Analyze the codebase.
2. Edit files or run terminal commands using tool calls.
3. Verify fixes by running typecheck or tests via execute_command tool.
4. Auto-correct errors if tests/typechecks fail.
5. Finish when all goals are met.`,
      },
      { role: "user", content: userPrompt },
    ];

    sendSSE({ type: "analysis_started", taskGroupId: dbTaskGroupId });

    let turn = 0;
    let isFinished = false;

    while (turn < this.MAX_TURNS && !isFinished) {
      turn++;

      // Simulate model payload request structure
      const payload = {
        model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        messages,
        tools: AGENT_TOOLS.map((t) => ({ type: "function", function: t })),
      };

      // Call Cloudflare AI REST endpoint
      const cfResponse = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.CLOUDFLARE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!cfResponse.ok) {
        const errorText = await cfResponse.text();
        sendSSE({ type: "error", error: `AI Provider Error: ${errorText}` });
        return;
      }

      const cfData: any = await cfResponse.json();
      const choice = cfData.result?.response || cfData.result?.choices?.[0]?.message;

      // Handle assistant text answer or tool call
      if (typeof choice === "string") {
        sendSSE({ type: "task_completed", summary: choice });
        isFinished = true;
        break;
      }

      if (choice?.tool_calls && choice.tool_calls.length > 0) {
        messages.push(choice);

        for (const toolCall of choice.tool_calls) {
          const { name, arguments: argsString } = toolCall.function;
          const parsedArgs = JSON.parse(argsString);

          sendSSE({
            type: "task_running",
            task: `Tool Call: ${name}`,
            args: parsedArgs,
          });

          try {
            const toolResult = await ToolDispatcher.executeTool(name, parsedArgs);

            sendSSE({
              type: "task_progress",
              tool: name,
              result: toolResult,
            });

            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(toolResult),
            });
          } catch (err: any) {
            sendSSE({
              type: "task_progress",
              tool: name,
              error: err.message,
            });

            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: err.message }),
            });
          }
        }
      } else {
        const reply = choice?.content || "Task completed successfully.";
        sendSSE({ type: "task_completed", summary: reply });
        isFinished = true;
      }
    }

    sendSSE({ type: "stream_finished" });
  }
}