export interface PendingApproval {
  id: string;
  command: string;
  reason: string;
  createdAt: number;
  status: "pending" | "approved" | "rejected";
}

class HITLGateService {
  private pendingMap: Map<string, PendingApproval> = new Map();

  createApprovalRequest(command: string, reason: string): PendingApproval {
    const id = `hitl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const approval: PendingApproval = {
      id,
      command,
      reason,
      createdAt: Date.now(),
      status: "pending",
    };
    this.pendingMap.set(id, approval);
    return approval;
  }

  resolveApproval(id: string, approved: boolean): boolean {
    const item = this.pendingMap.get(id);
    if (!item) return false;
    item.status = approved ? "approved" : "rejected";
    return true;
  }

  getPending(id: string): PendingApproval | undefined {
    return this.pendingMap.get(id);
  }
}

export const hitlGateService = new HITLGateService();