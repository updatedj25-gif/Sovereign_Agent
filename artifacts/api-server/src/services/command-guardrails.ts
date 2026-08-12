export type RiskLevel = "SAFE" | "LOW_RISK" | "HIGH_RISK_DESTRUCTIVE";

export interface RiskAnalysisResult {
  command: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  matchedRule?: string;
  explanation?: string;
}

export interface PendingCommandApproval {
  approvalId: string;
  sessionId: string;
  taskGroupId: number;
  command: string;
  riskResult: RiskAnalysisResult;
  createdAt: Date;
  status: "pending" | "approved" | "rejected";
}

export class CommandGuardrailService {
  private static pendingApprovals = new Map<string, PendingCommandApproval>();

  // Patterns that trigger HIGH_RISK_DESTRUCTIVE status and pause execution for user approval
  private static DESTRUCTIVE_PATTERNS = [
    { pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*f?|-f\s+-[rR])\s+/i, rule: "Recursive forced deletion (rm -rf)" },
    { pattern: /git\s+push\s+.*(--force|-f)/i, rule: "Force push to git remote" },
    { pattern: /git\s+reset\s+--hard/i, rule: "Hard reset uncommitted work" },
    { pattern: /DROP\s+(DATABASE|TABLE|SCHEMA)/i, rule: "Destructive SQL drop statement" },
    { pattern: /TRUNCATE\s+TABLE/i, rule: "SQL table truncate statement" },
    { pattern: /chmod\s+(-R\s+)?777/i, rule: "Overly permissive chmod 777" },
    { pattern: /curl\s+.*\|\s*(sh|bash)/i, rule: "Piping remote untrusted script to bash" },
    { pattern: /wget\s+.*\|\s*(sh|bash)/i, rule: "Piping remote untrusted script to bash" },
    { pattern: />\s*\/dev\/(sda|hda|nvme)/i, rule: "Direct block device write" },
    { pattern: /mkfs\./i, rule: "Format filesystem command" },
  ];

  /**
   * Analyzes shell command and determines risk level.
   */
  public static analyzeCommand(command: string): RiskAnalysisResult {
    for (const { pattern, rule } of this.DESTRUCTIVE_PATTERNS) {
      if (pattern.test(command)) {
        return {
          command,
          riskLevel: "HIGH_RISK_DESTRUCTIVE",
          requiresApproval: true,
          matchedRule: rule,
          explanation: `Command matches high-risk safety rule: "${rule}". Human approval is required in UI before proceeding.`,
        };
      }
    }

    // Low risk commands (network calls, package installs)
    if (command.includes("pnpm install") || command.includes("npm install") || command.includes("curl ")) {
      return {
        command,
        riskLevel: "LOW_RISK",
        requiresApproval: false,
      };
    }

    return {
      command,
      riskLevel: "SAFE",
      requiresApproval: false,
    };
  }

  /**
   * Creates a pending approval gate holding execution until user approves in UI.
   */
  public static createPendingApproval(
    sessionId: string,
    taskGroupId: number,
    command: string,
    riskResult: RiskAnalysisResult
  ): PendingCommandApproval {
    const approvalId = `approval_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const pending: PendingCommandApproval = {
      approvalId,
      sessionId,
      taskGroupId,
      command,
      riskResult,
      createdAt: new Date(),
      status: "pending",
    };

    this.pendingApprovals.set(approvalId, pending);
    return pending;
  }

  /**
   * Resolves approval state when user clicks Approve or Reject in the UI.
   */
  public static resolveApproval(
    approvalId: string,
    approved: boolean
  ): PendingCommandApproval | null {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) return null;

    pending.status = approved ? "approved" : "rejected";
    this.pendingApprovals.set(approvalId, pending);
    return pending;
  }

  public static getPendingApproval(approvalId: string): PendingCommandApproval | undefined {
    return this.pendingApprovals.get(approvalId);
  }
}