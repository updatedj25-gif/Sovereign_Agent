import { MessageNode, TokenBudgetManager } from "./token-budget-manager";

export interface PruneOptions {
  maxStdoutLength?: number; // e.g. 300 chars
  preserveErrorLogs?: boolean; // Always keep stderr intact
  keepRecentTurnsIntact?: number; // Keep last N turns unpruned
}

export class ContextPruner {
  /**
   * Prunes verbose stdout / tool outputs from historical messages while preserving errors.
   */
  public static pruneMessageContext(
    messages: MessageNode[],
    options: PruneOptions = {}
  ): MessageNode[] {
    const maxStdoutLength = options.maxStdoutLength || 300;
    const keepRecent = options.keepRecentTurnsIntact || 2;

    const totalMessages = messages.length;

    return messages.map((msg, index) => {
      // Do not prune system messages or recent active turns
      if (msg.role === "system" || index >= totalMessages - keepRecent) {
        return msg;
      }

      let content = msg.content;

      // Prune long STDOUT / Tool Outputs inside message text
      if (content.includes("STDOUT:") || content.includes("OBSERVATION")) {
        content = this.pruneStdoutBlocks(content, maxStdoutLength);
      }

      // Prune long JSON response outputs
      if (content.length > 1500 && (content.includes('"output":') || content.includes('"stdout":'))) {
        content = this.pruneJsonOutput(content, maxStdoutLength);
      }

      return {
        ...msg,
        content,
        tokens: TokenBudgetManager.estimateTokens(content),
      };
    });
  }

  /**
   * Strips middle portion of stdout strings, keeping head and tail lines.
   */
  private static pruneStdoutBlocks(text: string, maxLength: number): string {
    return text.replace(/STDOUT:\n([\s\S]*?)(?=\nSTDERR:|\nOBSERVATION:|$)/g, (match, stdoutText) => {
      if (stdoutText.length <= maxLength) {
        return match;
      }

      const lines = stdoutText.split("\n");
      const totalLines = lines.length;

      if (totalLines <= 10) {
        return `STDOUT:\n${stdoutText.substring(0, maxLength)}...\n[STDOUT PRUNED]`;
      }

      const head = lines.slice(0, 4).join("\n");
      const tail = lines.slice(lines.length - 4).join("\n");
      const omitted = totalLines - 8;

      return `STDOUT:\n${head}\n... [${omitted} lines of stdout pruned to save context window] ...\n${tail}`;
    });
  }

  /**
   * Truncates long string values inside JSON payloads.
   */
  private static pruneJsonOutput(jsonText: string, maxLength: number): string {
    try {
      const parsed = JSON.parse(jsonText);
      if (parsed.output && typeof parsed.output === "string" && parsed.output.length > maxLength) {
        parsed.output = `${parsed.output.substring(0, maxLength)}... [Output Pruned: ${parsed.output.length - maxLength} chars omitted]`;
        return JSON.stringify(parsed, null, 2);
      }
    } catch {
      // Return regex fallback if not strict JSON
    }
    return jsonText;
  }
}