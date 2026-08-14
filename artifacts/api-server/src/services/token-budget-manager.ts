import * as ts from "typescript";

export interface MessageNode {
  role: "system" | "user" | "assistant";
  content: string;
  tokens?: number;
}

export interface ContextBudgetConfig {
  maxTotalTokens: number;
  systemPromptReserve: number;
  responseReserve: number;
  maxHistoryTokens: number;
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
      const lines = code.split("\n");
      const keepLines = Math.floor((targetTokenLimit * 3.8) / 40);
      return `${lines.slice(0, keepLines).join("\n")}\n\n// ... [File truncated: ${lines.length - keepLines} lines omitted for token budget]`;
    }

    const sourceFile = ts.createSourceFile(
      filePath,
      code,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith(".tsx") || filePath.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    const lines = code.split("\n");
    const collapsedLines = [...lines];

    const visit = (node: ts.Node) => {
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isMethodDeclaration(node) ||
          ts.isArrowFunction(node)) &&
        node.body
      ) {
        const startPos = sourceFile.getLineAndCharacterOfPosition(node.body.getStart(sourceFile));
        // Fix: node.body.getEnd() takes 0 arguments in TS Compiler API
        const endPos = sourceFile.getLineAndCharacterOfPosition(node.body.getEnd());

        const startLine = startPos.line;
        const endLine = endPos.line;

        if (endLine - startLine > 4) {
          const indent = " ".repeat(startPos.character + 2);
          collapsedLines[startLine + 1] = `${indent}// ... [Function body collapsed: ${endLine - startLine - 2} lines omitted]`;
          for (let l = startLine + 2; l < endLine; l++) {
            collapsedLines[l] = "";
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return collapsedLines.filter((l) => l !== "").join("\n");
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

    const currentTotalTokens =
      systemMessages.reduce((sum, m) => sum + this.estimateTokens(m.content), 0) +
      historyMessages.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);

    const maxAllowedHistoryTokens =
      budget.maxTotalTokens - budget.systemPromptReserve - budget.responseReserve;

    if (currentTotalTokens <= maxAllowedHistoryTokens) {
      return messages;
    }

    const recentWindowCount = 4;
    if (historyMessages.length > recentWindowCount) {
      const olderMessages = historyMessages.slice(0, historyMessages.length - recentWindowCount);
      const recentMessages = historyMessages.slice(historyMessages.length - recentWindowCount);

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