import { Router, type Request, type Response } from "express";
import { db, taskGroupsTable, commandsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
import { sandboxService } from "../services/sandbox";
import { toolRegistry } from "../agent/tools";
import { hitlGateService } from "../services/hitl-gate";
import { agentLoop } from "../services/agent-loop";

const router = Router();

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_KEY = process.env.CLOUDFLARE_API_KEY;
const CLOUDFLARE_EMAIL = process.env.CLOUDFLARE_EMAIL;
const CLOUDFLARE_AI_MODEL =
  process.env.CLOUDFLARE_AI_MODEL ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const AGENT_SYSTEM_PROMPT = `You are Sovereign, an expert full-stack coding agent running inside a live project.

CRITICAL RULES — never violate these:
1. ALWAYS edit/update/patch EXISTING files when a user asks to add to, change, or improve something already created. NEVER create a new folder or duplicate file for a feature that belongs in an existing one. For example, if a sidebar already exists in Shell.tsx, add to Shell.tsx — do not scaffold a new layout folder.
2. Output ONLY production-ready, working code. No stubs, no TODOs, no placeholder text, no mock data unless the user explicitly asks for it.
3. Show the EXACT file path at the top of every code block: // FILE: path/to/file.tsx
4. When modifying an existing file, show the COMPLETE updated file content — not a diff, not just the changed section.
5. Never invent packages that don't exist. Use only packages already in package.json or standard Node/browser APIs.
6. Prefer editing the smallest number of files needed to accomplish the task.
7. Code must compile and run without errors. Include all required imports.`;

let geminiClient: GoogleGenAI | null = null;
function getGemini() {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return geminiClient;
}

const cfAI = async (
  messages: Array<{ role: string; content: string }>,
  signal?: AbortSignal
) => {
  if (CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_API_KEY && CLOUDFLARE_EMAIL) {
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${CLOUDFLARE_AI_MODEL}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Auth-Email": CLOUDFLARE_EMAIL,
            "X-Auth-Key": CLOUDFLARE_API_KEY,
          },
          body: JSON.stringify({ messages }),
          signal,
        }
      );
      if (res.ok) {
        const data = (await res.json()) as { result?: { response?: string }; response?: string };
        const text = data?.result?.response ?? (data as { response?: string })?.response;
        if (text) return text;
      }
    } catch {
      /* Fallback to Gemini below */
    }
  }

  const gemini = getGemini();
  if (gemini) {
    const sysMsg = messages.find((m) => m.role === "system")?.content;
    const userPrompt = messages.filter((m) => m.role !== "system").map((m) => `${m.role}: ${m.content}`).join("\n\n");
    const response = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: userPrompt || "Hello",
      config: sysMsg ? { systemInstruction: sysMsg } : undefined,
    });
    return response.text ?? "";
  }

  return "Sovereign Agent AI response: Simulated agent execution step completed successfully.";
};

// POST /api/agent/approve — Approve or reject HITL tool call
router.post("/approve", (req: Request, res: Response) => {
  const { approvalId, approved } = req.body as {
    approvalId?: string;
    approved?: boolean;
  };

  if (!approvalId || typeof approved !== "boolean") {
    res.status(400).json({ error: "approvalId and approved (boolean) are required" });
    return;
  }

  const success = hitlGateService.resolveApproval(approvalId, approved);
  if (!success) {
    res.status(404).json({ error: "Approval request not found or expired" });
    return;
  }

  res.json({
    success: true,
    approvalId,
    status: approved ? "approved" : "rejected",
  });
});

// GET /api/agent/pending-approvals — List active pending HITL approval requests
router.get("/pending-approvals", (_req: Request, res: Response) => {
  res.json({ pending: hitlGateService.getAllPendingApprovals() });
});

// POST /api/agent/chat — single (non-streaming) response
router.post("/chat", async (req: Request, res: Response) => {
  const { prompt, history = [] } = req.body as {
    prompt: string;
    history?: Array<{ role: string; content: string }>;
  };
  if (!prompt?.trim()) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }
  try {
    const messages = [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      ...history,
      { role: "user", content: prompt },
    ];
    const response = await cfAI(messages);
    res.json({ response });
  } catch (err) {
    req.log.error({ err }, "Agent chat error");
    res.status(502).json({ error: "AI service error" });
  }
});

// POST /api/agent/stream — SSE streaming with DB persistence and real Sandbox execution
router.post("/stream", async (req: Request, res: Response) => {
  const { prompt, history = [] } = req.body as {
    prompt: string;
    history?: Array<{ role: string; content: string }>;
  };
  if (!prompt?.trim()) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  const send = (data: object) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Create a task group in the DB to persist this session
  let taskGroupId: number | null = null;
  let workspaceGroupId = "";

  try {
    const [group] = await db
      .insert(taskGroupsTable)
      .values({ title: prompt.slice(0, 120), status: "running" })
      .returning();
    taskGroupId = group.id;
    workspaceGroupId = String(taskGroupId);
    send({ type: "session_created", taskGroupId });
  } catch (dbErr) {
    workspaceGroupId = `ws-${Date.now()}`;
    req.log.warn({ dbErr }, "Could not create task group — continuing without DB persistence");
  }

  // Ensure workspace cleanup on socket disconnect/close
  let cleanedUp = false;
  const doCleanup = async () => {
    if (!cleanedUp && workspaceGroupId) {
      cleanedUp = true;
      try {
        await sandboxService.cleanup(workspaceGroupId);
      } catch (e) {
        req.log.warn({ e, workspaceGroupId }, "Sandbox cleanup error");
      }
    }
  };

  res.on("close", () => {
    doCleanup();
  });

  try {
    // Initialize workspace sandbox
    await sandboxService.createWorkspace(workspaceGroupId);

    // Execute Autonomous Agent Loop (Observe -> Plan -> Execute -> Evaluate)
    const result = await agentLoop.run({
      prompt,
      history,
      workspaceGroupId,
      dbTaskGroupId: taskGroupId,
      maxTurns: 20,
      onEvent: send,
    });

    // Mark task group status in DB
    const finalStatus = result.success ? "success" : "failed";
    if (taskGroupId) {
      try {
        await db
          .update(taskGroupsTable)
          .set({
            status: finalStatus,
            summary: result.finalResponse.slice(0, 250),
          })
          .where(eq(taskGroupsTable.id, taskGroupId));
      } catch {
        /* non-fatal */
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err }, "Agent stream error");
    send({ type: "error", message });
    if (taskGroupId) {
      try {
        await db
          .update(taskGroupsTable)
          .set({ status: "failed" })
          .where(eq(taskGroupsTable.id, taskGroupId));
      } catch {
        /* non-fatal */
      }
    }
  } finally {
    await doCleanup();
    if (!res.writableEnded) res.end();
  }
});

export default router;
