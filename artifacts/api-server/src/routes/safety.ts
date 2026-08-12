import { Router, Request, Response } from "express";
import { CommandGuardrailService } from "../services/command-guardrails";
import { GitCheckpointManager } from "../services/git-checkpoint-manager";

export const safetyRouter = Router();

/**
 * POST /api/safety/check-command
 * Analyzes command risk and checks if user confirmation is required
 */
safetyRouter.post("/check-command", (req: Request, res: Response) => {
  const { command, sessionId, taskGroupId } = req.body;

  if (!command) {
    return res.status(400).json({ error: "command is required" });
  }

  const riskResult = CommandGuardrailService.analyzeCommand(command);

  if (riskResult.requiresApproval && sessionId && taskGroupId) {
    const pending = CommandGuardrailService.createPendingApproval(
      sessionId,
      taskGroupId,
      command,
      riskResult
    );
    return res.json({ riskResult, pendingApproval: pending });
  }

  return res.json({ riskResult });
});

/**
 * POST /api/safety/approve
 * Resolves pending command approval from UI button click
 */
safetyRouter.post("/approve", (req: Request, res: Response) => {
  const { approvalId, approved } = req.body;

  if (!approvalId) {
    return res.status(400).json({ error: "approvalId is required" });
  }

  const resolved = CommandGuardrailService.resolveApproval(approvalId, !!approved);
  if (!resolved) {
    return res.status(404).json({ error: "Pending approval ID not found" });
  }

  return res.json({ success: true, pendingApproval: resolved });
});

/**
 * POST /api/safety/checkpoint/create
 * Creates a Git snapshot checkpoint before major task step execution
 */
safetyRouter.post("/checkpoint/create", async (req: Request, res: Response) => {
  try {
    const { sessionId, stepName, cwd } = req.body;

    if (!sessionId || !stepName) {
      return res.status(400).json({ error: "sessionId and stepName are required" });
    }

    const checkpoint = await GitCheckpointManager.createCheckpoint(sessionId, stepName, cwd);
    return res.json({ success: true, checkpoint });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/safety/checkpoint/rollback
 * Reverts sandbox workspace to a previous checkpoint
 */
safetyRouter.post("/checkpoint/rollback", async (req: Request, res: Response) => {
  try {
    const { sessionId, checkpointId, cwd } = req.body;

    if (!sessionId || !checkpointId) {
      return res.status(400).json({ error: "sessionId and checkpointId are required" });
    }

    const result = await GitCheckpointManager.rollbackToCheckpoint(sessionId, checkpointId, cwd);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/safety/checkpoints/:sessionId
 * Lists available checkpoints for a session
 */
safetyRouter.get("/checkpoints/:sessionId", (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const list = GitCheckpointManager.listCheckpoints(sessionId);
  return res.json({ sessionId, checkpoints: list });
});