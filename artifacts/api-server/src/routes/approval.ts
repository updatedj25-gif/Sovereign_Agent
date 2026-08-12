import { Router, Request, Response } from "express";

export interface PendingApproval {
  id: string;
  tool: string;
  arguments: Record<string, any>;
  resolve: (value: boolean) => void;
  createdAt: number;
}

/** Global shared state map tracking pending human authorization promises */
export const pendingApprovalsMap = new Map<string, PendingApproval>();

export const approvalRouter = Router();

// ==========================================
// POST /api/agent/approve — Human authorization endpoint
// ==========================================
approvalRouter.post("/approve", (req: Request, res: Response) => {
  const { approvalId, approved, reason } = req.body;

  if (!approvalId || typeof approved !== "boolean") {
    return res.status(400).json({
      error: "Missing required payload fields: 'approvalId' (string) and 'approved' (boolean).",
    });
  }

  const pending = pendingApprovalsMap.get(approvalId);

  if (!pending) {
    return res.status(404).json({
      error: `No pending approval request found matching ID '${approvalId}'. It may have timed out.`,
    });
  }

  // Resolve pending promise in stream handler
  pending.resolve(approved);
  pendingApprovalsMap.delete(approvalId);

  console.log(`[HITL Approval] Decision for ${approvalId} (${pending.tool}): ${approved ? "APPROVED" : "REJECTED"}`);

  return res.json({
    success: true,
    approvalId,
    approved,
    reason: reason || (approved ? "User granted permission" : "User denied permission"),
  });
});