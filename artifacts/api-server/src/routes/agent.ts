import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { taskGroupsTable, commandsTable, insertTaskGroupSchema, updateTaskGroupSchema, insertCommandSchema } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function cfAiUrl(model: string) {
  return `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${model}`;
}

const AGENT_CAPABILITIES = [
  { method: "GET",    path: "/api/tasks",                     description: "List all task groups with status and metadata" },
  { method: "POST",   path: "/api/tasks",                     description: "Create a new task group (title, status)" },
  { method: "GET",    path: "/api/tasks/:id",                 description: "Get a task group and all its command logs" },
  { method: "PATCH",  path: "/api/tasks/:id",                 description: "Update task group status or summary" },
  { method: "DELETE", path: "/api/tasks/:id",                 description: "Delete a task group" },
  { method: "POST",   path: "/api/tasks/:id/commands",        description: "Append a command log (cmd, exitCode, stdout, stderr)" },
  { method: "GET",    path: "/api/tasks/:id/commands",        description: "List all commands for a task group" },
  { method: "GET",    path: "/api/agent/context",             description: "Read full workspace context: all tasks, commands, stats, and capabilities" },
  { method: "GET",    path: "/api/agent/capabilities",        description: "List all available API capabilities" },
  { method: "POST",   path: "/api/agent/stream",              description: "Stream agent reasoning + task execution (SSE)" },
];

async function buildContext() {
  const groups = await db
    .select()
    .from(taskGroupsTable)
    .orderBy(desc(taskGroupsTable.createdAt));

  const allCommands = await db
    .select()
    .from(commandsTable)
    .orderBy(commandsTable.createdAt);

  const commandsByGroup = new Map<number, typeof allCommands>();
  for (const cmd of allCommands) {
    const list = commandsByGroup.get(cmd.taskGroupId) ?? [];
    list.push(cmd);
    commandsByGroup.set(cmd.taskGroupId, list);
  }

  const stats = {
    total: groups.length,
    pending: groups.filter(g => g.status === "pending").length,
    running: groups.filter(g => g.status === "running").length,
    success: groups.filter(g => g.status === "success").length,
    failed:  groups.filter(g => g.status === "failed").length,
  };

  const taskGroups = groups.map(g => ({
    ...g,
    commands: commandsByGroup.get(g.id) ?? [],
  }));

  return { stats, taskGroups, capabilities: AGENT_CAPABILITIES };
}

function buildSystemPrompt(context: Awaited<ReturnType<typeof buildContext>>) {
  const { stats, taskGroups, capabilities } = context;

  const taskSummary = taskGroups.length === 0
    ? "No task groups exist yet."
    : taskGroups.map(g => {
        const cmds = g.commands.length === 0
          ? "  (no commands yet)"
          : g.commands.map(c =>
              `  - [exit:${c.exitCode ?? "?"}] $ ${c.cmd}${c.stderr ? `\n    STDERR: ${c.stderr.slice(0, 200)}` : ""}`
            ).join("\n");
        return `[${g.id}] ${g.title} (${g.status})${g.summary ? `\n  Summary: ${g.summary}` : ""}\n${cmds}`;
      }).join("\n\n");

  const capabilitiesSummary = capabilities
    .map(c => `  ${c.method} ${c.path} — ${c.description}`)
    .join("\n");

  return `You are Sovereign, an autonomous AI coding agent running on Cloudflare's infrastructure.

## RULE #1 — ALWAYS READ CONTEXT FIRST
Before creating any task, you MUST examine the workspace context below. Never create duplicate tasks. Never pile up tasks randomly. If a task already exists with "running" or "pending" status, do NOT create another one for the same goal.

## Current Workspace State
Stats: ${stats.total} total | ${stats.pending} pending | ${stats.running} running | ${stats.success} success | ${stats.failed} failed

${taskSummary}

## Available API Capabilities
${capabilitiesSummary}

## Output Format — MANDATORY
When creating or updating tasks, you MUST emit structured JSON blocks inline with your response. The frontend parses these to render live accordion UI:

\`\`\`json
{
  "id": "task-<unique-slug>",
  "title": "Human-readable milestone title",
  "status": "running",
  "summary": "What this task is doing",
  "commands": [
    { "cmd": "the exact command", "exitCode": 0, "stdout": "output", "stderr": "" }
  ]
}
\`\`\`

## Rules
1. Read context above before deciding what to do.
2. Work sequentially — complete one task group before starting another.
3. If a task failed, examine its stderr before deciding next steps.
4. Never hallucinate file paths, package names, or commands — only reference real data from context.
5. Emit one JSON block per task group. Update status to "success" or "failed" when done.`;
}

router.get("/agent/context", async (req, res) => {
  try {
    const context = await buildContext();
    res.json(context);
  } catch (err) {
    req.log.error(err, "Failed to build agent context");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/agent/capabilities", (_req, res) => {
  res.json({ capabilities: AGENT_CAPABILITIES });
});

const streamBodySchema = z.object({
  prompt: z.string().min(1).max(4000),
  model: z.string().optional(),
});

router.post("/agent/stream", async (req, res) => {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    res.status(503).json({ error: "Cloudflare credentials not configured (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN)" });
    return;
  }

  const parsed = streamBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const { prompt, model = CF_MODEL } = parsed.data;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendEvent = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendEvent({ type: "status", message: "Reading workspace context…" });

    const context = await buildContext();
    const systemPrompt = buildSystemPrompt(context);

    sendEvent({ type: "context", stats: context.stats, taskCount: context.taskGroups.length });

    const cfUrl = cfAiUrl(model);

    const cfRes = await fetch(cfUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        stream: true,
        max_tokens: 4096,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: prompt },
        ],
      }),
    });

    if (!cfRes.ok) {
      const errText = await cfRes.text();
      req.log.error({ status: cfRes.status, body: errText }, "Cloudflare AI request failed");
      sendEvent({ type: "error", message: `Cloudflare AI error (${cfRes.status}): ${errText.slice(0, 300)}` });
      res.end();
      return;
    }

    sendEvent({ type: "status", message: "Streaming agent response…" });

    const reader = cfRes.body?.getReader();
    if (!reader) {
      sendEvent({ type: "error", message: "No response body from Cloudflare AI" });
      res.end();
      return;
    }

    let fullText = "";
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;

        try {
          const parsed = JSON.parse(payload) as { response?: string };
          const token = parsed.response ?? "";
          if (token) {
            fullText += token;
            sendEvent({ type: "token", content: token });
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    }

    await persistTaskBlocks(fullText, req.log);

    sendEvent({ type: "done", fullText });
    res.end();
  } catch (err) {
    req.log.error(err, "Agent stream error");
    sendEvent({ type: "error", message: "Agent stream failed unexpectedly" });
    res.end();
  }
});

const taskBlockSchema = z.object({
  id:       z.string(),
  title:    z.string(),
  status:   z.enum(["pending", "running", "success", "failed"]),
  summary:  z.string().optional(),
  commands: z.array(z.object({
    cmd:      z.string(),
    exitCode: z.number().nullable().optional(),
    stdout:   z.string().optional().default(""),
    stderr:   z.string().optional().default(""),
  })).optional().default([]),
});

async function persistTaskBlocks(text: string, log: import("pino").Logger) {
  const jsonBlockRegex = /```json\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = jsonBlockRegex.exec(text)) !== null) {
    try {
      const raw = JSON.parse(match[1]);
      const block = taskBlockSchema.safeParse(raw);
      if (!block.success) continue;

      const { title, status, summary, commands } = block.data;

      const existing = await db
        .select()
        .from(taskGroupsTable)
        .where(eq(taskGroupsTable.title, title));

      let groupId: number;

      if (existing.length > 0) {
        const [updated] = await db
          .update(taskGroupsTable)
          .set({ status, summary: summary ?? null, updatedAt: new Date() })
          .where(eq(taskGroupsTable.id, existing[0].id))
          .returning();
        groupId = updated.id;
      } else {
        const [created] = await db
          .insert(taskGroupsTable)
          .values(insertTaskGroupSchema.parse({ title, status, summary }))
          .returning();
        groupId = created.id;
      }

      for (const cmd of commands) {
        await db
          .insert(commandsTable)
          .values(insertCommandSchema.parse({
            taskGroupId: groupId,
            cmd: cmd.cmd,
            exitCode: cmd.exitCode ?? null,
            stdout: cmd.stdout ?? "",
            stderr: cmd.stderr ?? "",
          }));
      }
    } catch (err) {
      log.warn({ err }, "Failed to persist task block");
    }
  }
}

router.post("/agent/tasks/execute", async (req, res) => {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    res.status(503).json({ error: "Cloudflare credentials not configured" });
    return;
  }

  const schema = z.object({
    taskId: z.number().int(),
    instruction: z.string().min(1).max(2000),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const { taskId, instruction } = parsed.data;

  const [group] = await db.select().from(taskGroupsTable).where(eq(taskGroupsTable.id, taskId));
  if (!group) return void res.status(404).json({ error: "Task group not found" });

  const commands = await db
    .select()
    .from(commandsTable)
    .where(eq(commandsTable.taskGroupId, taskId))
    .orderBy(commandsTable.createdAt);

  const context = await buildContext();
  const systemPrompt = buildSystemPrompt(context);

  const taskContext = `
## Target Task Group
ID: ${group.id}
Title: ${group.title}
Status: ${group.status}
${group.summary ? `Summary: ${group.summary}` : ""}
Commands so far:
${commands.length === 0 ? "(none)" : commands.map(c => `  [exit:${c.exitCode ?? "?"}] $ ${c.cmd}\n  ${c.stdout.slice(0, 200)}${c.stderr ? `\n  ERR: ${c.stderr.slice(0, 200)}` : ""}`).join("\n")}

## Instruction
${instruction}`;

  try {
    const cfRes = await fetch(cfAiUrl(CF_MODEL), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        max_tokens: 2048,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: taskContext },
        ],
      }),
    });

    if (!cfRes.ok) {
      const err = await cfRes.text();
      return void res.status(502).json({ error: err.slice(0, 300) });
    }

    const data = await cfRes.json() as { result?: { response?: string } };
    const response = data?.result?.response ?? "";

    await persistTaskBlocks(response, req.log);

    res.json({ response, taskId });
  } catch (err) {
    req.log.error(err, "Failed to execute task via AI");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/agent/tasks/summary", async (req, res) => {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    res.status(503).json({ error: "Cloudflare credentials not configured" });
    return;
  }

  try {
    const context = await buildContext();
    const { stats, taskGroups } = context;

    const taskList = taskGroups.map(g =>
      `- [${g.status.toUpperCase()}] ${g.title}${g.summary ? `: ${g.summary}` : ""} (${g.commands.length} commands)`
    ).join("\n");

    const cfRes = await fetch(cfAiUrl(CF_MODEL), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        max_tokens: 512,
        messages: [
          { role: "system", content: "You are a concise technical project manager. Summarize the current state of an AI coding agent's task queue in 2-3 sentences. Be specific about what's done, what's in progress, and what needs attention." },
          { role: "user",   content: `Stats: ${JSON.stringify(stats)}\n\nTasks:\n${taskList || "(none)"}` },
        ],
      }),
    });

    if (!cfRes.ok) {
      const errText = await cfRes.text();
      req.log.error({ status: cfRes.status, body: errText }, "Cloudflare AI summary request failed");
      return void res.status(502).json({ error: `Cloudflare AI error (${cfRes.status})` });
    }

    const data = await cfRes.json() as { result?: { response?: string; choices?: Array<{ message?: { content?: string } }> } };
    const summary = data?.result?.response
      ?? data?.result?.choices?.[0]?.message?.content
      ?? "No tasks in queue yet.";

    res.json({ summary, stats, taskCount: taskGroups.length });
  } catch (err) {
    req.log.error(err, "Failed to generate summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
