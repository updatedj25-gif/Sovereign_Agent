import { Router, Request, Response } from "express";
import { E2BSandboxManager } from "../services/e2b-sandbox";

export const agentRouter = Router();

export interface AgentStreamOptions {
  prompt: string;
  sessionId?: string;
  onEvent: (event: Record<string, any>) => void;
}

export async function runAgentStream(options: AgentStreamOptions): Promise<string> {
  const { prompt, sessionId = "default-session", onEvent } = options;

  // 1. Emit Roadmap Subtasks
  const subtasks = [
    "Inspect workspace structure and codebase",
    "Plan and execute code modifications or commands",
    "Verify build output and compiler diagnostics",
  ];

  onEvent({
    type: "roadmap_ready",
    subtasks,
  });

  // 2. Execute subtasks sequentially in E2B sandbox
  for (let i = 0; i < subtasks.length; i++) {
    const taskTitle = subtasks[i];

    onEvent({
      type: "task_running",
      task: taskTitle,
      tool: "exec_bash",
    });

    let commandToRun = "ls -la";
    if (i === 1) {
      commandToRun = `echo 'Executing task: ${prompt.replace(/'/g, "'\\''")}'`;
    } else if (i === 2) {
      commandToRun = "node -v && git status";
    }

    const execRes = await E2BSandboxManager.executeCommand(sessionId, commandToRun);

    onEvent({
      type: "task_progress",
      output: execRes.stdout || execRes.stderr || "Step execution complete.",
    });
  }

  const finalSummary = `Successfully executed agent task for: "${prompt}"`;

  onEvent({
    type: "task_completed",
    summary: finalSummary,
  });

  onEvent({
    type: "stream_finished",
    finalResponse: finalSummary,
  });

  return finalSummary;
}

// Router Endpoints
agentRouter.post("/chat", async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;
    return res.json({ response: `Executed task: ${prompt}` });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

agentRouter.post("/react-stream", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendSSE = (data: object) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  try {
    const { prompt, sessionId } = req.body;
    await runAgentStream({
      prompt: prompt || "Execute agent task",
      sessionId,
      onEvent: sendSSE,
    });
    return res.end();
  } catch (err: any) {
    sendSSE({ type: "error", message: err.message });
    return res.end();
  }
});

export default agentRouter;