import { Router, Request, Response } from "express";
import { applyBlockPatch } from "../tools/patcher";

export const githubRouter = Router();

const GITHUB_API_BASE = "https://api.github.com";

function getGithubHeaders() {
  const token = process.env.GITHUB_TOKEN;
  return {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "Sovereign-Agent-Server",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Safely encodes path segments while preserving forward slashes for GitHub REST API
 */
function formatGithubContentsUrl(owner: string, repo: string, filePath?: string): string {
  if (!filePath || !filePath.trim()) {
    return `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents`;
  }
  
  const cleanPath = filePath.replace(/^\/+|\/+$/g, "");
  const encodedSegments = cleanPath.split("/").map(encodeURIComponent).join("/");
  return `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodedSegments}`;
}

// ==========================================
// 1. GET /api/github/user — Authenticated user info
// ==========================================
githubRouter.get("/user", async (_req: Request, res: Response) => {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/user`, {
      headers: getGithubHeaders(),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch GitHub user profile." });
    }

    const data = await response.json();
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ==========================================
// 2. GET /api/github/repos — List user repositories
// ==========================================
githubRouter.get("/repos", async (_req: Request, res: Response) => {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/user/repos?sort=updated&per_page=30`, {
      headers: getGithubHeaders(),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch repositories." });
    }

    const data = await response.json();
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ==========================================
// 3. GET /api/github/repos/:owner/:repo/tree — Repository file tree
// ==========================================
githubRouter.get("/repos/:owner/:repo/tree", async (req: Request, res: Response) => {
  const { owner, repo } = req.params;
  const branch = (req.query.branch as string) || "main";

  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      { headers: getGithubHeaders() }
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch git tree." });
    }

    const data = await response.json();
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ==========================================
// 4. GET /api/github/repos/:owner/:repo/contents — Read file contents via ?path= query param
// Note: Uses query param ?path= to satisfy Express 5 path-to-regexp v8 rules
// ==========================================
githubRouter.get("/repos/:owner/:repo/contents", async (req: Request, res: Response) => {
  const { owner, repo } = req.params;
  const filePath = (req.query.path as string) || "";

  try {
    const url = formatGithubContentsUrl(owner, repo, filePath);
    const response = await fetch(url, { headers: getGithubHeaders() });

    if (!response.ok) {
      return res.status(response.status).json({ error: `File not found at path: '${filePath}'` });
    }

    const data = (await response.json()) as any;

    // Decode base64 content if single file query
    if (!Array.isArray(data) && data.content && data.encoding === "base64") {
      const decodedContent = Buffer.from(data.content, "base64").toString("utf-8");
      return res.json({
        ...data,
        decodedContent,
      });
    }

    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ==========================================
// 5. POST /api/github/repos/:owner/:repo/patch — Apply AST precision block patch & commit back to GitHub
// ==========================================
githubRouter.post("/repos/:owner/:repo/patch", async (req: Request, res: Response) => {
  const { owner, repo } = req.params;
  const { path: filePath, searchBlock, replaceBlock, commitMessage, branch = "main" } = req.body;

  if (!filePath || !searchBlock || replaceBlock === undefined) {
    return res.status(400).json({
      error: "Missing required payload fields: 'path', 'searchBlock', and 'replaceBlock'.",
    });
  }

  try {
    // 1. Fetch original file contents from GitHub
    const getUrl = `${formatGithubContentsUrl(owner, repo, filePath)}?ref=${encodeURIComponent(branch)}`;
    const fileRes = await fetch(getUrl, { headers: getGithubHeaders() });

    if (!fileRes.ok) {
      return res.status(404).json({ error: `Target file '${filePath}' not found on GitHub repository.` });
    }

    const fileData = (await fileRes.json()) as any;
    const originalContent = Buffer.from(fileData.content, "base64").toString("utf-8");
    const fileSha = fileData.sha;

    // 2. Apply Precision Block Patch & AST Validation
    const patchResult = applyBlockPatch(originalContent, searchBlock, replaceBlock, {
      filePath,
      validateAst: true,
    });

    if (!patchResult.success) {
      return res.status(422).json({
        error: "Patch application failed.",
        details: patchResult.error,
        astErrors: patchResult.astErrors,
      });
    }

    // 3. Commit updated content back to GitHub via REST API
    const updatedBase64 = Buffer.from(patchResult.patchedCode!, "utf-8").toString("base64");
    const putUrl = formatGithubContentsUrl(owner, repo, filePath);

    const commitRes = await fetch(putUrl, {
      method: "PUT",
      headers: {
        ...getGithubHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: commitMessage || `agent: precision block patch ${filePath}`,
        content: updatedBase64,
        sha: fileSha,
        branch,
      }),
    });

    if (!commitRes.ok) {
      const commitErr = await commitRes.text();
      return res.status(commitRes.status).json({
        error: "Failed to commit patched file to GitHub.",
        details: commitErr,
      });
    }

    const commitData = await commitRes.json();

    return res.json({
      success: true,
      message: `Successfully applied AST-verified patch to ${filePath}`,
      matchedLine: patchResult.matchedLine,
      replacedLinesCount: patchResult.replacedLinesCount,
      commit: commitData.commit,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
});