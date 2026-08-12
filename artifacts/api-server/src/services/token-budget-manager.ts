import * as ts from "typescript";

export interface MessageNode {
  role: "system" | "user" | "assistant";
  content: string;
  tokens?: number;
}

export interface ContextBudgetConfig {
  maxTotalTokens: number; // e.g. 16,000 or 128,000
  systemPromptReserve: number; // e.g. 2,000 tokens reserved for system/tools
  responseReserve: number; // e.g. 2,000 tokens reserved for LLM generation
  maxHistoryTokens: number; // Remainder allocated for message history
}

export class TokenBudgetManager {
  /**
   * Fast, reliable token estimation (approx ~4 characters per token).
   */
  public static estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 3.8);
  }

  /**
   * Truncates file code while preserving AST structure (imports, exports, function/class signatures).
   */
  public static truncateCodeAST(
    filePath: string,
    code: string,
    targetTokenLimit: number
  ): string {
    const currentTokens = this.estimateTokens(code);
    if (currentTokens <= targetTokenLimit) {
      return code;
    }

    if (!filePath.match(/\.(ts|tsx|js|jsx)$/)) {
      // Fallback simple line truncation for non-JS/TS files
      const lines = code.split("\n");
      const keepLines = Math.floor(targetTokenLimit * 3.8 / 40);
      return `${lines.slice(0, keepLines).join("\n")}\n\n// ... [File truncated: ${lines.length - keepLines} lines omitted for token budget]`;
    }

    // AST-aware truncation using TypeScript Compiler API
    const sourceFile = ts.createSourceFile(
      filePath,
      code,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith(".tsx") || filePath.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    const lines = code.split("\n");
    const collapsedLines = [...lines];

    // Collapse function bodies and class methods
    const visit = (node: ts.Node) => {
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isMethodDeclaration(node) ||
          ts.isArrowFunction(node)) &&
        node.body
      ) {
        const startPos = sourceFile.getLineAndCharacterOfPosition(node.body.getStart(sourceFile));
        const endPos = sourceFile.getLineAndCharacterOfPosition(node.body.getEnd(sourceFile));

        const startLine = startPos.line;
        const endLine = endPos.line;

        if (endLine - startLine > 4) {
          // Keep signature line and opening brace, collapse middle
          const indent = " ".repeat(startPos.character + 2);
          collapsedLines[startLine + 1] = `${indent}// ... [Function body collapsed: ${endLine - startLine - 2} lines omitted]`;
          for (let l = startLine + 2; l < endLine; l++) {
            collapsedLines[l] = ""; // Blank out collapsed lines
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    const truncatedResult = collapsedLines.filter((l) => l !== "").join("\n");
    return truncatedResult;
  }

  /**
   * Applies sliding window trimming and conversation summarization if tokens exceed budget.
   */
  public static async optimizeMessageHistory(
    messages: MessageNode[],
    budget: ContextBudgetConfig
  ): Promise<MessageNode[]> {
    const systemMessages = messages.filter((m) => m.role === "system");
    let historyMessages = messages.filter((m) => m.role !== "system");

    let currentTotalTokens =
      systemMessages.reduce((sum, m) => sum + this.estimateTokens(m.content), 0) +
      historyMessages.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);

    const maxAllowedHistoryTokens =
      budget.maxTotalTokens - budget.systemPromptReserve - budget.responseReserve;

    if (currentTotalTokens <= maxAllowedHistoryTokens) {
      return messages;
    }

    console.log(
      `[Token Budget Manager] Exceeded history limit (${currentTotalTokens} / ${maxAllowedHistoryTokens} tokens). Optimizing context...`
    );

    // Keep system prompt + last 4 turns (recent active window)
    const recentWindowCount = 4;
    if (historyMessages.length > recentWindowCount) {
      const olderMessages = historyMessages.slice(0, historyMessages.length - recentWindowCount);
      const recentMessages = historyMessages.slice(historyMessages.length - recentWindowCount);

      // Summarize older turns into a single high-level summary node
      const summaryText = this.createSummaryNode(olderMessages);

      historyMessages = [
        {
          role: "user",
          content: `### HISTORICAL CONTEXT SUMMARY\n${summaryText}`,
        },
        ...recentMessages,
      ];
    }

    return [...systemMessages, ...historyMessages];
  }

  private static createSummaryNode(messages: MessageNode[]): string {
    const summaryLines = messages.map((m) => {
      const roleName = m.role.toUpperCase();
      const snippet = m.content.substring(0, 120).replace(/\n/g, " ");
      return `- **${roleName}**: ${snippet}...`;
    });

    return `The following ${messages.length} previous turns were condensed:\n${summaryLines.join("\n")}`;
  }
}