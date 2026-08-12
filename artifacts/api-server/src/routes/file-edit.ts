import { Router, Request, Response } from "express";
import { EditVerificationService } from "../services/edit-verifier";
import { DiffParserService } from "../services/diff-parser";

export const editRouter = Router();

/**
 * POST /api/edit/apply-diff
 * Parses SEARCH/REPLACE blocks, applies changes with fuzzy matching, and runs typechecks.
 */
editRouter.post("/apply-diff", async (req: Request, res: Response) => {
  try {
    const { sessionId, diffResponse, checkCommand, cwd } = req.body;

    if (!sessionId || !diffResponse) {
      return res.status(400).json({ error: "sessionId and diffResponse are required" });
    }

    const result = await EditVerificationService.applyAndVerify(sessionId, diffResponse, {
      checkCommand,
      cwd,
    });

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/edit/parse-only
 * Validates search/replace blocks without executing or writing files
 */
editRouter.post("/parse-only", (req: Request, res: Response) => {
  const { diffResponse } = req.body;
  if (!diffResponse) return res.status(400).json({ error: "diffResponse is required" });

  const parsed = DiffParserService.parseSearchReplaceBlocks(diffResponse);
  return res.json(parsed);
});