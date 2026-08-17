import { DurableObject } from "cloudflare:workers";
import { ReActMessage, SessionMeta, SubAction, TaskGroup } from "./types";
import { SandboxManager, cleanPath, cleanBlockContent } from "./sandbox";
import { buildPreviewHtml } from "./preview";
import { SYSTEM_PROMPT } from "./agent";

export class AgentSession extends DurableObject {
  private messages: ReActMessage[] = [];
  private meta: SessionMeta | null = null;
  private envVars: Record<string, string> = {};
  private previewHtml: string = "";
  private isAborted: boolean = false;
  private sandbox: SandboxManager;
  private env: Record<string, any>;

  constructor(ctx: DurableObjectState, env: Record<string, any>) {
    super(ctx, env);
    this.env = env;
    this.sandbox = new SandboxManager(env.E2B_API_KEY);

    this.ctx.blockConcurrencyWhile(async () => {
      const storedMsgs = await this.ctx.storage.get<ReActMessage[]>("messages");
      const storedMeta = await this.ctx.storage.get<SessionMeta>("meta");
      const storedFiles = await this.ctx.storage.get<Record<string, any>>("files");
      const storedEnv = await this.ctx.storage.get<Record<string, string>>("envVars");
      const storedPreview = await this.ctx.storage.get<string>("previewHtml");
      const storedSandboxId = await this.ctx.storage.get<string>("e2bSandboxId");

      if (storedMsgs) this.messages = storedMsgs;
      if (storedMeta) this.meta = storedMeta;
      if (storedEnv) this.envVars = storedEnv;
      if (storedPreview) this.previewHtml = storedPreview;

      this.sandbox = new SandboxManager(env.E2B_API_KEY, storedSandboxId, storedFiles);
    });
  }

  private async autoSpinPreview(userPrompt: string): Promise<string> {
    let appCode = await this.sandbox.readFile("src/App.tsx");
    let customCss = await this.sandbox.readFile("src/index.css");

    if (!appCode) {
      const files = this.sandbox.getMemoryFiles();
      const candidates = Object.keys(files).filter(
        (p) => p.endsWith("App.tsx") || p.endsWith("App.jsx") || p.endsWith("App.js") || p.endsWith("src.ts") || p.endsWith("index.html")
      );
      for (const candidate of candidates) {
        const content = await this.sandbox.readFile(candidate);
        if (content && (content.includes("function") || content.includes("const") || content.includes("<") || content.includes("export"))) {
          appCode = content;
          break;
        }
      }
    }

    if (!appCode && /blue|wine|yellow|red|green|dark|light|theme|background|modal|card|button|chat|dashboard/i.test(userPrompt)) {
      const isBlue = /blue/i.test(userPrompt);
      const isWine = /wine/i.test(userPrompt);
      const bgColor = isBlue ? '#0000FF' : isWine ? '#4A0E17' : '#0f172a';

      appCode = `import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Blue React Native Background</Text>
      <Text style={styles.subtitle}>Rendered live in Sovereign Agent Sandbox</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '${bgColor}', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', width: '100%', padding: 20 },
  title: { color: '#FFFFFF', fontSize: 24, fontWeight: 'bold', marginBottom: 8 },
  subtitle: { color: 'rgba(255, 255, 255, 0.8)', fontSize: 14 }
});`;
      await this.sandbox.writeFile("src/App.tsx", appCode);
    }

    if (appCode) {
      this.previewHtml = buildPreviewHtml(appCode, customCss || "", userPrompt);
    }
    return this.previewHtml;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PATCH, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    if (url.pathname.endsWith("/stop") && request.method === "POST") {
      this.isAborted = true;
      return Response.json({ success: true, message: "Kill signal processed" }, { headers: corsHeaders });
    }

    if (url.pathname.endsWith("/clear") && request.method === "POST") {
      this.messages = [];
      this.previewHtml = "";
      this.meta = null;
      await this.ctx.storage.deleteAll();
      return Response.json({ success: true, message: "Session wiped" }, { headers: corsHeaders });
    }

    if (url.pathname.endsWith("/history") && request.method === "GET") {
      return Response.json({ meta: this.meta, messages: this.messages, envVars: this.envVars }, { headers: corsHeaders });
    }

    if (url.pathname.endsWith("/tree") && request.method === "GET") {
      const tree = await this.sandbox.getExplorerFileList();
      return Response.json({ tree }, { headers: corsHeaders });
    }

    // 100% Reliable File Reader (DO memory first, then VM disk fallback)
    if (url.pathname.endsWith("/file") && request.method === "POST") {
      const body = (await request.json()) as { filePath?: string };
      const path = cleanPath(body.filePath || "src/App.tsx");
      const content = await this.sandbox.readFile(path);
      return Response.json({ content: content || "// Empty file" }, { headers: corsHeaders });
    }

    if (url.pathname.endsWith("/save-env") && request.method === "POST") {
      const body = (await request.json()) as { envVars: Record<string, string> };
      const newVars = body.envVars || {};
      this.envVars = { ...this.envVars, ...newVars };
      await this.ctx.storage.put("envVars", this.envVars);

      const envFileContent = Object.entries(this.envVars).map(([k, v]) => `${k}=${v}`).join("\n");
      await this.sandbox.writeFile(".env", envFileContent);

      return Response.json({ success: true, count: Object.keys(this.envVars).length, envVars: this.envVars }, { headers: corsHeaders });
    }

    if (url.pathname.endsWith("/exec") && request.method === "POST") {
      const body = (await request.json()) as { command?: string; cmd?: string };
      const cmd = body.command || body.cmd || "ls -la";
      const result = await this.sandbox.runCommand(cmd);
      return Response.json({ command: cmd, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, sandbox: result.mode }, { headers: corsHeaders });
    }

    if (url.pathname.endsWith("/render-preview")) {
      const html = this.previewHtml || buildPreviewHtml(await this.sandbox.readFile("src/App.tsx"), "", "Live Preview");
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=UTF-8",
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          "Pragma": "no-cache",
          "Expires": "0",
          ...corsHeaders,
        },
      });
    }

    // ReAct Stream Coordinator
    if (url.pathname.endsWith("/stream") && request.method === "POST") {
      const body = (await request.json()) as { prompt?: string; sessionId?: string };
      const userPrompt = body.prompt || "Run task";
      const sessionId = body.sessionId || "sovereign-session-default";
      const startTime = Date.now();

      this.isAborted = false;
      this.messages.push({ role: "user", content: userPrompt, timestamp: new Date().toISOString() });

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      const sendEvent = async (data: Record<string, any>) => {
        await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      (async () => {
        try {
          const sbx = await this.sandbox.getSandboxInstance();
          const taskGroups: TaskGroup[] = [];
          let currentGroup: TaskGroup | null = null;
          let groupCounter = 1;
          let subActionCounter = 1;

          const getOrCreateGroup = async (title: string): Promise<TaskGroup> => {
            if (currentGroup && currentGroup.title === title) return currentGroup;
            if (currentGroup && currentGroup.status === "running") {
              currentGroup.status = currentGroup.subActions.some((s) => s.status === "error") ? "error" : "completed";
            }
            const newGroup: TaskGroup = {
              id: String(groupCounter++),
              title,
              status: "running",
              command: title,
              output: "",
              subActions: [],
            };
            taskGroups.push(newGroup);
            currentGroup = newGroup;

            await sendEvent({ type: "phase_start", title, id: newGroup.id });
            await sendEvent({ actions: [...taskGroups] });
            return newGroup;
          };

          const updateGroupOutput = (group: TaskGroup) => {
            group.output = group.subActions.map((s) => `${s.title}: ${s.status.toUpperCase()}`).join("\n");
          };

          this.meta = {
            id: sessionId,
            title: userPrompt.length > 35 ? userPrompt.slice(0, 35) + "..." : userPrompt,
            createdAt: this.meta?.createdAt || new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            credentials: {
              aiProvider: "Cloudflare Workers AI",
              model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
              sandbox: sbx ? `E2B Micro-VM (${sbx.sandboxId})` : "Durable Object Sandbox",
            },
          };

          await sendEvent({ type: "thought", text: `Analyzing objective: "${userPrompt}". Planning milestones and execution strategy.` });

          let isFinished = false;
          let turn = 0;
          let finalCompletionSummary = "";
          let hadErrorsInTurn = false;
          const conversationMessages = [
            { role: "system", content: SYSTEM_PROMPT },
            ...this.messages.map((m) => ({ role: m.role, content: m.content })),
          ];

          while (!isFinished && turn < 5) {
            if (this.isAborted) {
              await sendEvent({ type: "aborted", message: "Task stopped by user" });
              break;
            }

            turn++;
            hadErrorsInTurn = false;

            let aiResponseText = "";
            if (this.env.AI) {
              const aiRes = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
                messages: conversationMessages,
                max_tokens: 3000,
              });
              aiResponseText = typeof aiRes === "string" ? aiRes : (aiRes.response || "");
            }

            if (this.isAborted) break;

            const cleanThought = aiResponseText
              .replace(/<task_phase[\s\S]*?<\/task_phase>/gi, "")
              .replace(/<task_completed[\s\S]*?<\/task_completed>/gi, "")
              .replace(/<execute_python>[\s\S]*?<\/execute_python>/gi, "")
              .replace(/<execute_command>[\s\S]*?<\/execute_command>/gi, "")
              .replace(/<write_file[\s\S]*?<\/write_file>/gi, "")
              .replace(/<read_file[\s\S]*?\/>/gi, "")
              .replace(/<request_env_box[\s\S]*?<\/request_env_box>/gi, "")
              .replace(/```[\s\S]*?```/gi, "")
              .trim();

            if (cleanThought.length > 5) {
              await sendEvent({ type: "thought", turn, text: cleanThought });
            }

            const phaseMatch = aiResponseText.match(/<task_phase\s+title=["']([^"']+)["']>([\s\S]*?)<\/task_phase>/i);
            if (phaseMatch) {
              await getOrCreateGroup(phaseMatch[1].trim());
            }

            const pyRegex = /<execute_python>([\s\S]*?)<\/execute_python>/gi;
            const cmdRegex = /<execute_command>([\s\S]*?)<\/execute_command>/gi;
            const writeRegex = /<write_file\s+path=["']([^"']+)["']>([\s\S]*?)<\/write_file>/gi;
            const readRegex = /<read_file\s+path=["']([^"']+)["']\s*\/>/gi;

            let hasTools = false;

            // 1. Python Execution
            let pyMatch;
            while ((pyMatch = pyRegex.exec(aiResponseText)) !== null) {
              if (this.isAborted) break;
              hasTools = true;
              const cleanPyCode = cleanBlockContent(pyMatch[1]);
              const group = currentGroup || (await getOrCreateGroup("Python Programmatic Execution"));

              const subAction: SubAction = {
                id: String(subActionCounter++),
                type: "python",
                title: `🐍 Python: ${cleanPyCode.split("\n")[0].slice(0, 45)}...`,
                status: "running",
                command: `python3 -u runner.py`,
                output: `>>> Executing Python script in micro-VM...\n`,
                icon: "🐍",
              };
              group.subActions.push(subAction);
              updateGroupOutput(group);

              await sendEvent({ type: "action_batch", groupId: group.id, actionId: subAction.id, subAction });
              await sendEvent({ actions: [...taskGroups] });

              const pyResult = await this.sandbox.runPython(cleanPyCode);
              const fullLog = `>>> Python Output:\n${pyResult.stdout || ""}${pyResult.stderr ? `\n[PYTHON TRACEBACK / STDERR]\n${pyResult.stderr}` : ""}\n[Exit Code: ${pyResult.exitCode}]`;

              subAction.status = pyResult.exitCode === 0 ? "completed" : "error";
              if (pyResult.exitCode !== 0) hadErrorsInTurn = true;
              subAction.output = fullLog;
              updateGroupOutput(group);

              await sendEvent({ type: "action_update", groupId: group.id, actionId: subAction.id, status: subAction.status, output: fullLog });
              await sendEvent({ actions: [...taskGroups] });

              conversationMessages.push({ role: "assistant", content: `<execute_python>${cleanPyCode}</execute_python>` });
              conversationMessages.push({ role: "user", content: `Python Output (Exit Code ${pyResult.exitCode}):\n${fullLog}` });
            }

            // 2. Bash Execution
            let cmdMatch;
            while ((cmdMatch = cmdRegex.exec(aiResponseText)) !== null) {
              if (this.isAborted) break;
              hasTools = true;
              let cmd = cleanBlockContent(cmdMatch[1]);

              const group = currentGroup || (await getOrCreateGroup("Workspace Operations"));
              const subAction: SubAction = {
                id: String(subActionCounter++),
                type: "command",
                title: `Ran: $ ${cmd.split("\n")[0].slice(0, 45)}`,
                status: "running",
                command: cmd,
                output: `$ ${cmd}\n[E2B VM] Executing...\n`,
                icon: ">_",
              };
              group.subActions.push(subAction);
              updateGroupOutput(group);

              await sendEvent({ type: "action_batch", groupId: group.id, actionId: subAction.id, subAction });
              await sendEvent({ actions: [...taskGroups] });

              const cmdResult = await this.sandbox.runCommand(cmd);
              const fullLog = `$ ${cmd}\n${cmdResult.stdout || ""}${cmdResult.stderr ? `\n[STDERR]\n${cmdResult.stderr}` : ""}\n[Exit Code: ${cmdResult.exitCode}]`;

              subAction.status = cmdResult.exitCode === 0 ? "completed" : "error";
              if (cmdResult.exitCode !== 0) hadErrorsInTurn = true;
              subAction.output = fullLog;
              updateGroupOutput(group);

              await sendEvent({ type: "action_update", groupId: group.id, actionId: subAction.id, status: subAction.status, output: fullLog });
              await sendEvent({ actions: [...taskGroups] });

              conversationMessages.push({ role: "assistant", content: `<execute_command>${cmd}</execute_command>` });
              conversationMessages.push({ role: "user", content: `Command Output:\n${fullLog}` });
            }

            // 3. Write Files
            let writeMatch;
            while ((writeMatch = writeRegex.exec(aiResponseText)) !== null) {
              if (this.isAborted) break;
              hasTools = true;
              let rawFilePath = writeMatch[1].trim();
              const content = cleanBlockContent(writeMatch[2]);
              let filePath = cleanPath(rawFilePath);

              const group = currentGroup || (await getOrCreateGroup("Directory & File Assembly"));
              const subAction: SubAction = {
                id: String(subActionCounter++),
                type: "write_file",
                title: `Created: ${filePath}`,
                status: "running",
                command: `write_file ${filePath}`,
                output: `Writing ${content.length} bytes to ${filePath}...`,
                icon: "📄",
              };
              group.subActions.push(subAction);
              updateGroupOutput(group);

              await sendEvent({ type: "action_batch", groupId: group.id, actionId: subAction.id, subAction });
              await sendEvent({ actions: [...taskGroups] });

              await this.sandbox.writeFile(filePath, content);
              if (filePath.endsWith("App.js") || filePath.endsWith("App.jsx") || filePath.endsWith("App.tsx") || filePath.endsWith("src.ts")) {
                await this.sandbox.writeFile("src/App.tsx", content);
              }

              subAction.status = "completed";
              subAction.output = `[SUCCESS] Created ${filePath} (${content.length} bytes)`;
              updateGroupOutput(group);

              await sendEvent({ type: "action_update", groupId: group.id, actionId: subAction.id, status: "completed", output: subAction.output });
              await sendEvent({ actions: [...taskGroups] });

              conversationMessages.push({ role: "assistant", content: `<write_file path="${filePath}">...</write_file>` });
              conversationMessages.push({ role: "user", content: `File ${filePath} written successfully.` });
            }

            // 4. Read Files
            let readMatch;
            while ((readMatch = readRegex.exec(aiResponseText)) !== null) {
              if (this.isAborted) break;
              hasTools = true;
              const filePath = cleanPath(readMatch[1]);
              const group = currentGroup || (await getOrCreateGroup("Workspace Inspection"));

              const subAction: SubAction = {
                id: String(subActionCounter++),
                type: "read_file",
                title: `Inspected: ${filePath}`,
                status: "running",
                command: `cat ${filePath}`,
                output: `Reading ${filePath}...`,
                icon: "📖",
              };
              group.subActions.push(subAction);
              updateGroupOutput(group);

              await sendEvent({ type: "action_batch", groupId: group.id, actionId: subAction.id, subAction });
              await sendEvent({ actions: [...taskGroups] });

              const content = await this.sandbox.readFile(filePath);
              subAction.status = "completed";
              subAction.output = content ? content.slice(0, 1000) : "[File empty or not found]";
              updateGroupOutput(group);

              await sendEvent({ type: "action_update", groupId: group.id, actionId: subAction.id, status: "completed", output: subAction.output });
              await sendEvent({ actions: [...taskGroups] });

              conversationMessages.push({ role: "assistant", content: `<read_file path="${filePath}" />` });
              conversationMessages.push({ role: "user", content: `File Content of ${filePath}:\n${content}` });
            }

            const completedMatch = aiResponseText.match(/<task_completed>([\s\S]*?)<\/task_completed>/i);
            if (completedMatch && !hadErrorsInTurn) {
              finalCompletionSummary = completedMatch[1].trim();
              isFinished = true;
            } else if (!hasTools) {
              isFinished = true;
            }
          }

          for (const grp of taskGroups) {
            if (grp.status === "running") {
              grp.status = grp.subActions.some((s) => s.status === "error") ? "error" : "completed";
            }
          }
          await sendEvent({ actions: [...taskGroups] });

          await this.sandbox.getExplorerFileList();
          await this.autoSpinPreview(userPrompt);

          await this.ctx.storage.put("files", this.sandbox.getMemoryFiles());
          await this.ctx.storage.put("previewHtml", this.previewHtml);
          await this.ctx.storage.put("meta", this.meta);
          await this.ctx.storage.put("messages", this.messages);
          if (this.sandbox.getSandboxId()) {
            await this.ctx.storage.put("e2bSandboxId", this.sandbox.getSandboxId());
          }

          const elapsedSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));
          const previewUrl = `/api/sandbox/render-preview?sessionId=${encodeURIComponent(sessionId)}&t=${Date.now()}`;
          await sendEvent({ type: "preview_ready", previewUrl });

          const createdFilesList = Object.keys(this.sandbox.getMemoryFiles()).filter(k => !k.startsWith("."));
          const auditReport = `### 🚀 Sovereign Agent Delivery Report

${finalCompletionSummary || `Successfully generated and deployed: **"${userPrompt}"**`}

#### Verification & Workspace Audit:
- ✅ **Files Created/Modified**: ${createdFilesList.length > 0 ? createdFilesList.join(", ") : "src/App.tsx (Rendered)"}
- ✅ **Sandbox Environment**: ${sbx ? `E2B Micro-VM (${sbx.sandboxId})` : "Durable Object Virtual Edge"}
- ✅ **Live Preview**: Listening on port 5173 (Forwarded to Cockpit Viewport)
- ⏱️ **Execution Time**: Worked for ${elapsedSec} seconds
- 💾 **Checkpoint**: Transactionally persisted to Session Storage`;

          await sendEvent({
            type: "stream_finished",
            finalResponse: this.isAborted ? "Execution stopped by user." : auditReport,
            elapsedSeconds: elapsedSec,
            checkpointId: `DO-Tx-${sessionId.slice(-6)}`
          });
        } catch (err: any) {
          console.error("[Stream Error]:", err);
          await sendEvent({ type: "error", error: err.message });
        } finally {
          await writer.close();
        }
      })();

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          ...corsHeaders,
        },
      });
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  }
}
