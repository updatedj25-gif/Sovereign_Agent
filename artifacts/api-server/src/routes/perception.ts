import { Router, Request, Response } from "express";
import { RepoMapService } from "../services/repo-map";
import { FastCodeSearchService } from "../services/code-search";
import { SemanticCodeIndexService } from "../services/semantic-index";

export const perceptionRouter = Router();

/**
 * POST /api/perception/repo-map
 * Generates an AST skeleton map for LLM system prompts
 */
perceptionRouter.post("/repo-map", (req: Request, res: Response) => {
  const { files, maxTokens } = req.body;
  if (!files || !Array.isArray(files)) {
    return res.status(400).json({ error: "files array is required" });
  }

  const map = RepoMapService.generateRepoMap(files, maxTokens || 2000);
  return res.json({ repoMap: map });
});

/**
 * POST /api/perception/search
 * Runs ripgrep symbol or text search inside sandbox
 */
perceptionRouter.post("/search", async (req: Request, res: Response) => {
  const { sessionId, query, isRegex, fileGlob } = req.body;
  if (!sessionId || !query) {
    return res.status(400).json({ error: "sessionId and query are required" });
  }

  const results = await FastCodeSearchService.ripgrep(sessionId, query, {
    isRegex,
    fileGlob,
  });
  return res.json({ query, results });
});

/**
 * POST /api/perception/semantic-search
 * Searches codebase using vector embeddings
 */
perceptionRouter.post("/semantic-search", async (req: Request, res: Response) => {
  const { query, topK } = req.body;
  if (!query) return res.status(400).json({ error: "query is required" });

  const results = await SemanticCodeIndexService.searchSemantic(query, topK || 5);
  return res.json({ query, results });
});