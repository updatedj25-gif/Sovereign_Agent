import { Router, Request, Response } from "express";
import { runAgentStream } from "../agent/agent";
import { pendingApprovalsMap } from "./approval";
import { globalToolRegistry } from "../agent/tools/registry";

export const streamRouter = Router();

// ==========================================
// POST /api/agent/stream — Main SSE Agent Stream Route
// ==========================================
streamRouter.post("/stream", async (req: Request, res: Response) => {
  const { prompt, taskGroupId, owner, repo } = req.body;

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Field 'prompt' is required." });
  }

  // Set SSE Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const writeSSE = (data: Record<string, any>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const abortController = new AbortController();
  req.on("close", () => {
    abortController.abort();
  });

  try {
    await runAgentStream({
      prompt,
      taskGroupId,
      owner,
      repo,
      signal: abortController.signal,
      onEvent: async (evt) => {
        // Intercept tool execution events requiring Human Approval
        if (evt.type === "task_running" && evt.tool) {
          const toolInstance = globalToolRegistry.getTool(evt.tool);

          if (toolInstance?.requiresApproval) {
            const approvalId = `appr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

            writeSSE({
              type: "approval_required",
              approvalId,
              tool: evt.tool,
              arguments: evt.arguments,
              message: `Tool '${evt.tool}' requires human approval before execution.`,
            });

            // Pause execution promise waiting for POST /api/agent/approve decision
            const isApproved = await new Promise<boolean>((resolve) => {
              const timer = setTimeout(() => {
                pendingApprovalsMap.delete(approvalId);
                resolve(false); // Default to deny on timeout
              }, 120000); // 2 minute approval window

              pendingApprovalsMap.set(approvalId, {
                id: approvalId,
                tool: evt.tool,
                arguments: evt.arguments,
                resolve: (decision) => {
                  clearTimeout(timer);
                  resolve(decision);
                },
                createdAt: Date.now(),
              });
            });

            if (!isApproved) {
              writeSSE({
                type: "task_completed",
                task: evt.tool,
                summary: `Execution of tool '${evt.tool}' denied by user.`,
              });
              return;
            }

            writeSSE({
              type: "approval_granted",
              approvalId,
              tool: evt.tool,
            });
          }
        }

        // Standard SSE event passthrough
        writeSSE(evt);
      },
    });
  } catch (err: any) {
    writeSSE({ type: "error", error: err.message || "Streaming error occurred." });
  } finally {
    res.end();
  }
});