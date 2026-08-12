export interface SecurityCheckResult {
  allowed: boolean;
  requiresHITL: boolean;
  reason?: string;
}

export class CommandSecurityValidator {
  private static BLOCKED_PATTERNS = [
    /rm\s+-rf\s+[\/\~]/i,             // Destruction of root/home
    />\s*\/dev\/sd[a-z]/i,             // Raw disk writes
    /mkfs/i,                           // Formatting drives
    /dd\s+if=/i,                       // Direct disk copy
    /shutdown|reboot|init\s+0/i,       // System power commands
    /chmod\s+-R\s+777\s+\//i,          // Unsafe permissions
    /:\(\)\s*\{\s*:\|\:&\s*\}\s*;/i,   // Fork bomb
  ];

  private static HIGH_RISK_PATTERNS = [
    /git\s+push\s+.*--force/i,         // Force push
    /npm\s+publish/i,                  // Package publishing
    /pnpm\s+publish/i,
    /drop\s+database/i,                // DB deletion
    /rm\s+-rf/i,                       // Recursive deletion
    /curl.*\|\s*bash/i,                // Pipe to bash
  ];

  /**
   * Inspects a command string and determines if it is safe to execute or requires human authorization.
   */
  static validate(command: string): SecurityCheckResult {
    const trimmed = command.trim();

    // Check hard blocked rules
    for (const pattern of this.BLOCKED_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          allowed: false,
          requiresHITL: false,
          reason: `Command rejected by security policy: Matches forbidden pattern (${pattern.source})`,
        };
      }
    }

    // Check high risk commands requiring user approval
    for (const pattern of this.HIGH_RISK_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          allowed: true,
          requiresHITL: true,
          reason: `High-risk command detected (${pattern.source}). Requires confirmation.`,
        };
      }
    }

    return {
      allowed: true,
      requiresHITL: false,
    };
  }
}