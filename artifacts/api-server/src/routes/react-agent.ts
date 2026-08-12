import { Router, Request, Response } from "express";
import { db, taskGroups } from "@workspace/db";
import { AutonomousReActEngine } from "../services/react-loop";

export const reactAgentRouter = Router();

/**
 * POST /api/agent/react-stream
 * SSE endpoint for initiating autonomous ReAct execution
 */
reactAgentRouter.post("/react-stream", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendSSE = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { prompt, sessionId = "default-session" } = req.body;

    if (!prompt) {
      sendSSE({ type: "error", message: "Prompt is required" });
      return res.end();
    }

    // 1. Create DB Task Group
    const [inserted] = await db
      .insert(taskGroups)
      .values({
        title: prompt.substring(0, 60),
        status: "running",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    sendSSE({
      type: "session_created",
      taskGroupId: inserted.id,
      sessionId,
    });

    // 2. Start Autonomous ReAct Execution Engine
    await AutonomousReActEngine.runLoop({
      taskGroupId: inserted.id,
      sessionId,
      userPrompt: prompt,
      sendSSE,
    });

    sendSSE({ type: "stream_finished" });
    return res.end();
  } catch (err: any) {
    sendSSE({ type: "error", message: err.message });
    return res.end();
  }
});