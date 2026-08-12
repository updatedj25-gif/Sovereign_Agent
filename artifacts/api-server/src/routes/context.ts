import { Router, Request, Response } from "express";
import { TokenBudgetManager, ContextBudgetConfig } from "../services/token-budget-manager";
import { ContextPruner } from "../services/context-pruner";

export const contextRouter = Router();

/**
 * POST /api/context/optimize
 * Accepts conversation messages, prunes stdout, applies AST truncation to attached files,
 * and fits payload into token budget.
 */
contextRouter.post("/optimize", async (req: Request, res: Response) => {
  try {
    const { messages, budget, pruneStdout = true } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array is required" });
    }

    const defaultConfig: ContextBudgetConfig = {
      maxTotalTokens: budget?.maxTotalTokens || 32000,
      systemPromptReserve: budget?.systemPromptReserve || 2000,
      responseReserve: budget?.responseReserve || 2000,
      maxHistoryTokens: budget?.maxHistoryTokens || 28000,
    };

    // Step 1: Prune verbose terminal outputs from history
    let processedMessages = pruneStdout
      ? ContextPruner.pruneMessageContext(messages)
      : messages;

    // Step 2: Apply token budget manager & sliding window summarization
    const optimizedMessages = await TokenBudgetManager.optimizeMessageHistory(
      processedMessages,
      defaultConfig
    );

    const totalEstimatedTokens = optimizedMessages.reduce(
      (sum, m) => sum + TokenBudgetManager.estimateTokens(m.content),
      0
    );

    return res.json({
      optimizedMessages,
      totalEstimatedTokens,
      prunedCount: messages.length - optimizedMessages.length,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/context/truncate-code
 * AST-aware code file truncation endpoint
 */
contextRouter.post("/truncate-code", (req: Request, res: Response) => {
  try {
    const { filePath, code, targetTokenLimit } = req.body;

    if (!filePath || !code) {
      return res.status(400).json({ error: "filePath and code are required" });
    }

    const truncated = TokenBudgetManager.truncateCodeAST(
      filePath,
      code,
      targetTokenLimit || 1000
    );

    return res.json({
      originalTokens: TokenBudgetManager.estimateTokens(code),
      truncatedTokens: TokenBudgetManager.estimateTokens(truncated),
      truncatedCode: truncated,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});