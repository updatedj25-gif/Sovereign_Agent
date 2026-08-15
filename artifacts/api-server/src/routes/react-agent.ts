import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { db, taskGroups } from "@workspace/db";
import { AutonomousReActEngine } from "../services/react-loop";

export const reactAgentRouter = Router();

/**
 * POST /api/agent/env-submit
 * Endpoint for securely receiving and applying user-supplied environment secrets (Cloudflare, GitHub, E2B, etc.)
 */
reactAgentRouter.post("/env-submit", async (req: Request, res: Response) => {
  try {
    const { envs = {}, workspaceGroupId } = req.body;
    if (!envs || typeof envs !== "object") {
      return res.status(400).json({ error: "Invalid environment variables payload" });
    }

    // Apply to current Node process.env
    for (const [k, v] of Object.entries(envs)) {
      if (typeof v === "string" && v.trim()) {
        process.env[k] = v.trim();
      }
    }

    // Optionally write to .env if writable
    try {
      const envPath = path.resolve(process.cwd(), ".env");
      let existingEnv = "";
      if (fs.existsSync(envPath)) {
        existingEnv = fs.readFileSync(envPath, "utf-8");
      }
      
      const parsedEnv: Record<string, string> = {};
      for (const line of existingEnv.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
            parsedEnv[key] = val;
          }
        }
      }

      for (const [k, v] of Object.entries(envs)) {
        if (typeof v === "string") {
          parsedEnv[k] = v.trim();
        }
      }

      const envLines = Object.entries(parsedEnv).map(([k, v]) => `${k}="${v}"`);
      fs.writeFileSync(envPath, envLines.join("\n") + "\n", "utf-8");
    } catch (fsErr) {
      console.warn("[Env] Could not write to .env file, retained in process.env memory:", fsErr);
    }

    return res.json({
      success: true,
      message: "Environment variables successfully saved and applied.",
      configuredKeys: Object.keys(envs),
    });
  } catch (err: any) {
    console.error("[Env] Submit error:", err);
    return res.status(500).json({ error: err.message || "Failed to save environment variables" });
  }
});

/**
 * GET /api/agent/env-status
 * Check configuration status of keys
 */
reactAgentRouter.get("/env-status", (req: Request, res: Response) => {
  const checkKey = (key: string) => {
    const val = process.env[key];
    return {
      name: key,
      configured: Boolean(val && val.length > 0 && !val.includes("MY_")),
      preview: val ? `${val.slice(0, 4)}...${val.slice(-3)}` : null,
    };
  };

  res.json({
    cloudflareApiKey: checkKey("CLOUDFLARE_API_KEY"),
    cloudflareAccountId: checkKey("CLOUDFLARE_ACCOUNT_ID"),
    cloudflareEmail: checkKey("CLOUDFLARE_EMAIL"),
    githubToken: checkKey("GITHUB_TOKEN"),
    githubRepo: checkKey("GITHUB_REPO"),
    e2bApiKey: checkKey("E2B_API_KEY"),
    geminiApiKey: checkKey("GEMINI_API_KEY"),
    databaseUrl: checkKey("DATABASE_URL"),
  });
});

/**
 * POST /api/agent/react-stream
 * SSE endpoint for initiating autonomous ReAct execution
 */
reactAgentRouter.post("/react-stream", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendSSE = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { prompt, sessionId = "default-session" } = req.body;

    if (!prompt) {
      sendSSE({ type: "error", message: "Prompt is required" });
      return res.end();
    }

    // 1. Create DB Task Group
    const [inserted] = await db
      .insert(taskGroups)
      .values({
        title: prompt.substring(0, 60),
        status: "running",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    sendSSE({
      type: "session_created",
      taskGroupId: inserted.id,
      sessionId,
    });

    // 2. Start Autonomous ReAct Execution Engine
    await AutonomousReActEngine.runLoop({
      taskGroupId: inserted.id,
      sessionId,
      userPrompt: prompt,
      sendSSE,
    });

    sendSSE({ type: "stream_finished" });
    return res.end();
  } catch (err: any) {
    sendSSE({ type: "error", message: err.message });
    return res.end();
  }
});