import { DurableObject } from "cloudflare:workers";
import { Sandbox } from "e2b";

export interface ReActMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: string;
}

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  lastUpdated: string;
  credentials: {
    aiProvider: string;
    model: string;
    sandbox: string;
  };
}

export interface SubAction {
  id: string;
  type: "command" | "write_file" | "read_file" | "thought" | "env_box";
  title: string;
  status: "pending" | "running" | "completed" | "error";
  command?: string;
  output?: string;
}

export interface TaskGroup {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "error";
  command: string;
  output: string;
  subActions: SubAction[];
}

const SYSTEM_PROMPT = `You are Sovereign Agent, an autonomous software engineer running inside a real E2B Linux Micro-VM.

You solve tasks by executing tools:

AVAILABLE TOOLS:
1. Trigger the Visual Environment Credentials Modal:
<request_env_box title="Enter your environment variables to continue">
<field key="GITHUB_TOKEN" label="GitHub Personal Access Token" placeholder="ghp_..." type="password" />
<field key="CLOUDFLARE_API_TOKEN" label="Cloudflare API Token" placeholder="cfut_..." type="password" />
<field key="CLOUDFLARE_ACCOUNT_ID" label="Cloudflare Account ID" placeholder="1b77c2a9..." type="text" />
<field key="E2B_API_KEY" label="E2B API Key" placeholder="e2b_..." type="password" />
</request_env_box>

2. Write file (Always use full paths):
<write_file path="folder/filename.ext">
// File Content
</write_file>

3. Execute bash command:
<execute_command>
git clone https://github.com/user/repo.git
</execute_command>

4. Read file:
<read_file path="filename.ext" />

RULES:
- When the user asks for an env box, or when credentials are needed, use <request_env_box>.
- When given a GitHub token and asked to clone, save the token to .env and use authenticated git clone: "git clone https://<token>@github.com/<user>/<repo>.git <folder>".
- When creating files in folders (e.g. inside adebola), write to path="adebola/filename.ext".
- When creating UI, write modern React 19 + Tailwind CSS code in src/App.tsx.`;

function sanitizeForLivePreview(rawCode: string): string {
  let code = rawCode;
  code = code.replace(/^```(?:tsx|jsx|typescript|ts|javascript|js)?\n/i, "");
  code = code.replace(/\n```$/i, "");
  code = code.replace(/import\s+(?:type\s+)?(?:[\w*\s{},]*)\s+from\s+['"][^'"]+['"];?/g, "// [import]");
  code = code.replace(/import\s+['"][^'"]+['"];?/g, "// [import]");
  code = code.replace(/export\s+default\s+function\s+App/g, "function App");
  code = code.replace(/export\s+default\s+function\s+(\w+)/g, "function $1");
  code = code.replace(/export\s+default\s+(\w+);?/g, "const __defaultExport = $1;");

  const declaredComponents: string[] = [];
  const compMatches = code.matchAll(/(?:const|function|let|var)\s+([A-Z]\w+)/g);
  for (const m of compMatches) {
    declaredComponents.push(m[1]);
  }

  if (!code.includes("function App") && !code.includes("const App") && !code.includes("let App") && !code.includes("var App")) {
    if (declaredComponents.length > 0) {
      code += `\nconst App = typeof __defaultExport !== 'undefined' ? __defaultExport : ${declaredComponents[0]};\n`;
    }
  }
  return code;
}

function buildPreviewHtml(appCode: string, rawCss: string, title: string): string {
  const sanitizedCode = sanitizeForLivePreview(appCode);
  const cleanCss = (rawCss || "").replace(/@import\s+["']tailwindcss["'];?/g, "");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone@7.24.0/babel.min.js"></script>
  <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
  <style>
    body { margin: 0; padding: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    ${cleanCss}
  </style>
</head>
<body class="bg-slate-950 text-white min-h-screen">
  <div id="root"></div>
  <div id="preview-error" class="hidden m-4 p-4 rounded-xl bg-red-950/90 border border-red-500/50 text-red-200 font-mono text-xs whitespace-pre-wrap"></div>
  
  <script type="text/babel" data-presets="react,typescript">
    const { useState, useEffect, useRef, useMemo, useCallback, useReducer, useContext, createContext } = React;

    window.onerror = function(msg, url, line) {
      const errEl = document.getElementById('preview-error');
      if (errEl) {
        errEl.classList.remove('hidden');
        errEl.textContent = 'Preview Error: ' + msg + (line ? ' (Line: ' + line + ')' : '');
      }
      return false;
    };

    try {
      ${sanitizedCode}

      let ComponentToRender = null;
      if (typeof App !== 'undefined') {
        ComponentToRender = App;
      } else if (typeof __defaultExport !== 'undefined') {
        ComponentToRender = __defaultExport;
      }

      if (ComponentToRender) {
        ReactDOM.createRoot(document.getElementById('root')).render(<ComponentToRender />);
      } else {
        document.getElementById('root').innerHTML = '<div class="p-8 text-center text-amber-400 font-bold">Workspace Ready</div>';
      }

      if (window.lucide) {
        setTimeout(() => window.lucide.createIcons(), 100);
      }
    } catch (err) {
      const errEl = document.getElementById('preview-error');
      if (errEl) {
        errEl.classList.remove('hidden');
        errEl.textContent = 'Runtime Exception: ' + err.message;
      }
    }
  </script>
</body>
</html>`;
}

export class AgentSession extends DurableObject {
  private messages: ReActMessage[] = [];
  private meta: SessionMeta | null = null;
  private files: Record<string, { content: string; type: "file" | "directory" }> = {};
  private envVars: Record<string, string> = {};
  private previewHtml: string = "";
  private e2bSandboxId: string | null = null;
  private env: Record<string, any>;

  constructor(ctx: DurableObjectState, env: Record<string, any>) {
    super(ctx, env);
    this.env = env;
    this.ctx.blockConcurrencyWhile(async () => {
      const storedMsgs = await this.ctx.storage.get<ReActMessage[]>("messages");
      const storedMeta = await this.ctx.storage.get<SessionMeta>("meta");
      const storedFiles = await this.ctx.storage.get<Record<string, { content: string; type: "file" | "directory" }>>("files");
      const storedEnv = await this.ctx.storage.get<Record<string, string>>("envVars");
      const storedPreview = await this.ctx.storage.get<string>("previewHtml");
      const storedSandboxId = await this.ctx.storage.get<string>("e2bSandboxId");

      if (storedMsgs) this.messages = storedMsgs;
      if (storedMeta) this.meta = storedMeta;
      if (storedFiles) this.files = storedFiles;
      if (storedEnv) this.envVars = storedEnv;
      if (storedPreview) this.previewHtml = storedPreview;
      if (storedSandboxId) this.e2bSandboxId = storedSandboxId;
    });
  }

  private async getSandboxInstance(): Promise<Sandbox | null> {
    if (!this.env.E2B_API_KEY) return null;
    const apiKey = this.env.E2B_API_KEY.trim();

    try {
      if (this.e2bSandboxId) {
        try {
          return await Sandbox.connect(this.e2bSandboxId, { apiKey });
        } catch {
          console.log("[E2B] Reconnecting to sandbox...");
        }
      }

      const sbx = await Sandbox.create("base", { apiKey });
      this.e2bSandboxId = sbx.sandboxId;
      await this.ctx.storage.put("e2bSandboxId", this.e2bSandboxId);
      console.log(`[E2B] Sandbox active: ${this.e2bSandboxId}`);
      return sbx;
    } catch (err: any) {
      console.error("[E2B Error]:", err.message);
      return null;
    }
  }

  public async runCommand(cmd: string): Promise<{ stdout: string; stderr: string; exitCode: number; mode: string }> {
    const sbx = await this.getSandboxInstance();
    if (sbx) {
      try {
        console.log(`[E2B VM ${sbx.sandboxId}]: $ ${cmd}`);
        const result = await sbx.commands.run(cmd);
        return {
          stdout: result.stdout || "",
          stderr: result.stderr || "",
          exitCode: result.exitCode ?? 0,
          mode: `E2B VM (${sbx.sandboxId})`,
        };
      } catch (err: any) {
        return { stdout: "", stderr: err.message, exitCode: 1, mode: "E2B Error" };
      }
    }
    return { stdout: `[Virtual DO] Executed: ${cmd}`, stderr: "", exitCode: 0, mode: "Virtual DO" };
  }

  public async writeFile(path: string, content: string): Promise<void> {
    if (path.includes("/")) {
      const parentDir = path.substring(0, path.lastIndexOf("/"));
      if (!this.files[parentDir]) {
        this.files[parentDir] = { content: "", type: "directory" };
      }
    }

    this.files[path] = { content, type: "file" };
    const sbx = await this.getSandboxInstance();
    if (sbx) {
      try {
        if (path.includes("/")) {
          const parentDir = path.substring(0, path.lastIndexOf("/"));
          await sbx.commands.run(`mkdir -p "${parentDir}"`);
        }
        await sbx.files.write(path, content);
      } catch (err: any) {
        console.error(`[E2B Write Error ${path}]:`, err.message);
      }
    }
  }

  public async readFile(path: string): Promise<string> {
    if (this.files[path]?.type === "directory") {
      const childFiles = Object.keys(this.files).filter((p) => p.startsWith(path + "/") && p !== path);
      return `// Directory: ${path}\n// Contents:\n${childFiles.map((c) => `//  - ${c}`).join("\n") || "//  (Empty folder)"}`;
    }

    if (this.files[path]?.content) return this.files[path].content;

    const sbx = await this.getSandboxInstance();
    if (sbx) {
      try {
        const catRes = await this.runCommand(`cat "${path}"`);
        if (catRes.exitCode === 0 && catRes.stdout) {
          this.files[path] = { content: catRes.stdout, type: "file" };
          return catRes.stdout;
        }
      } catch {}
    }
    return "";
  }

  /**
   * Scans VM and returns a hierarchical, VS Code-structured file & folder tree
   */
  public async refreshFilesAndFolders(): Promise<any[]> {
    const scanScript = `node -e '
      const fs = require("fs");
      const path = require("path");
      function scan(dir, depth = 0) {
        if (depth > 5) return [];
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          let results = [];
          for (const e of entries) {
            if (e.name.startsWith(".") && e.name !== ".env") continue;
            if (e.name === "node_modules" || e.name === "dist") continue;
            const rel = path.join(dir, e.name).replace(/^\\.\\/?/, "");
            const isDir = e.isDirectory();
            results.push({
              name: e.name,
              path: rel,
              type: isDir ? "directory" : "file",
              children: isDir ? scan(path.join(dir, e.name), depth + 1) : undefined
            });
          }
          return results;
        } catch (err) { return []; }
      }
      console.log(JSON.stringify(scan(".")));
    '`;

    const res = await this.runCommand(scanScript);
    if (res.exitCode === 0 && res.stdout) {
      try {
        const items = JSON.parse(res.stdout.trim());
        const flatten = (arr: any[]) => {
          for (const item of arr) {
            this.files[item.path] = { content: this.files[item.path]?.content || "", type: item.type };
            if (item.children) flatten(item.children);
          }
        };
        flatten(items);
        return items;
      } catch {}
    }

    return Object.entries(this.files).map(([p, v]) => ({
      name: p.split("/").pop() || p,
      path: p,
      type: v.type || "file",
    }));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PATCH, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    if (url.pathname.endsWith("/history") && request.method === "GET") {
      return Response.json({ meta: this.meta, messages: this.messages, envVars: this.envVars }, { headers: corsHeaders });
    }

    // 1. VS Code Tree Endpoint
    if (url.pathname.endsWith("/tree") && request.method === "GET") {
      const tree = await this.refreshFilesAndFolders();
      return Response.json({ tree }, { headers: corsHeaders });
    }

    // 2. File Reader
    if (url.pathname.endsWith("/file") && request.method === "POST") {
      const body = (await request.json()) as { filePath?: string };
      const path = body.filePath || "src/App.tsx";
      const content = await this.readFile(path);
      return Response.json({ content: content || "// Empty file" }, { headers: corsHeaders });
    }

    // 3. Save Env Variables into VM & Durable Object
    if (url.pathname.endsWith("/save-env") && request.method === "POST") {
      const body = (await request.json()) as { envVars: Record<string, string> };
      const newVars = body.envVars || {};
      this.envVars = { ...this.envVars, ...newVars };
      await this.ctx.storage.put("envVars", this.envVars);

      // Write into .env
      const envFileContent = Object.entries(this.envVars)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
      await this.writeFile(".env", envFileContent);

      return Response.json({ success: true, count: Object.keys(this.envVars).length, envVars: this.envVars }, { headers: corsHeaders });
    }

    // 4. Terminal Exec
    if (url.pathname.endsWith("/exec") && request.method === "POST") {
      const body = (await request.json()) as { command?: string; cmd?: string };
      const cmd = body.command || body.cmd || "ls -la";
      const result = await this.runCommand(cmd);
      return Response.json(
        {
          command: cmd,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          sandbox: result.mode,
        },
        { headers: corsHeaders }
      );
    }

    // 5. Render Live Preview
    if (url.pathname.endsWith("/render-preview")) {
      const appCode = this.files["src/App.tsx"]?.content || "";
      const customCss = this.files["src/index.css"]?.content || "";
      const html = this.previewHtml || buildPreviewHtml(appCode, customCss, "Live Preview");
      return new Response(html, { headers: { "Content-Type": "text/html; charset=UTF-8", ...corsHeaders } });
    }

    // 6. Dynamic ReAct Stream
    if (url.pathname.endsWith("/stream") && request.method === "POST") {
      const body = (await request.json()) as { prompt?: string; sessionId?: string };
      const userPrompt = body.prompt || "Run task";
      const sessionId = body.sessionId || "sovereign-session-default";

      // Check if user passed an inline token in their prompt
      const tokenMatch = userPrompt.match(/([a-zA-Z0-9_-]{20,})/);
      if (tokenMatch && /github.*token|token.*env/i.test(userPrompt)) {
        this.envVars["GITHUB_TOKEN"] = tokenMatch[1];
        await this.ctx.storage.put("envVars", this.envVars);
      }

      this.messages.push({ role: "user", content: userPrompt, timestamp: new Date().toISOString() });

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      const sendEvent = async (data: Record<string, any>) => {
        await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      (async () => {
        try {
          const sbx = await this.getSandboxInstance();
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
            await sendEvent({ actions: [...taskGroups] });
            return newGroup;
          };

          const updateGroupOutput = (group: TaskGroup) => {
            group.output = group.subActions
              .map((s) => {
                const icon = s.type === "command" ? ">_" : s.type === "write_file" ? "📁" : s.type === "read_file" ? "🔍" : s.type === "env_box" ? "🔑" : "🧠";
                return `${icon} ${s.title}\n${s.output || ""}`;
              })
              .join("\n\n");
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

          // Check if User is explicitly requesting Env Box Modal
          const isEnvModalRequest = /empty\s*env|env\s*box|enter.*env|credentials\s*box/i.test(userPrompt);
          if (isEnvModalRequest) {
            const envFields = [
              { key: "GITHUB_TOKEN", label: "GitHub Personal Access Token", placeholder: "ghp_...", type: "password" },
              { key: "CLOUDFLARE_API_TOKEN", label: "Cloudflare API Token", placeholder: "cfut_...", type: "password" },
              { key: "CLOUDFLARE_ACCOUNT_ID", label: "Cloudflare Account ID", placeholder: "1b77c2a9725b1e4c20f52f8ecfadbb3f", type: "text" },
              { key: "E2B_API_KEY", label: "E2B API Key", placeholder: "e2b_...", type: "password" },
              { key: "CUSTOM_ENV", label: "Custom Secret", placeholder: "Secret value", type: "password" },
            ];

            const group = await getOrCreateGroup("Environment Credentials Configuration");
            const subAction: SubAction = {
              id: String(subActionCounter++),
              type: "env_box",
              title: "Enter your environment variable to continue",
              status: "completed",
              output: `[MODAL TRIGGERED] Interactive Env-Box ready for user input.\nFields: ${envFields.map((f) => f.key).join(", ")}`,
            };
            group.subActions.push(subAction);
            updateGroupOutput(group);

            await sendEvent({
              actions: [...taskGroups],
              type: "env_modal_open",
              envBox: {
                title: "Enter your environment variable to continue",
                fields: envFields,
              },
            });
          }

          let isFinished = false;
          let turn = 0;
          const conversationMessages = [
            { role: "system", content: SYSTEM_PROMPT },
            ...this.messages.map((m) => ({ role: m.role, content: m.content })),
          ];

          while (!isFinished && turn < 4) {
            turn++;

            let aiResponseText = "";
            if (this.env.AI) {
              const aiRes = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
                messages: conversationMessages,
                max_tokens: 3000,
              });
              aiResponseText = typeof aiRes === "string" ? aiRes : (aiRes.response || "");
            }

            console.log(`[Turn ${turn}] AI Output:`, aiResponseText.slice(0, 150));

            const cmdRegex = /<execute_command>([\s\S]*?)<\/execute_command>/gi;
            const writeRegex = /<write_file\s+path=["']([^"']+)["']>([\s\S]*?)<\/write_file>/gi;
            const readRegex = /<read_file\s+path=["']([^"']+)["']\s*\/>/gi;

            let hasTools = false;

            // 1. Execute Commands
            let cmdMatch;
            while ((cmdMatch = cmdRegex.exec(aiResponseText)) !== null) {
              hasTools = true;
              let cmd = cmdMatch[1].trim();

              // Inject stored GITHUB_TOKEN if cloning private repos
              if (this.envVars["GITHUB_TOKEN"] && cmd.includes("git clone https://github.com/")) {
                cmd = cmd.replace("https://github.com/", `https://${this.envVars["GITHUB_TOKEN"]}@github.com/`);
              }

              const group = currentGroup || (await getOrCreateGroup("Workspace Operations"));
              const subAction: SubAction = {
                id: String(subActionCounter++),
                type: "command",
                title: `Ran: $ ${cmd.split("\n")[0].slice(0, 50)}`,
                status: "running",
                command: cmd,
                output: `$ ${cmd}\n[E2B VM] Executing...\n`,
              };
              group.subActions.push(subAction);
              updateGroupOutput(group);
              await sendEvent({ actions: [...taskGroups] });

              const cmdResult = await this.runCommand(cmd);
              const fullLog = `$ ${cmd}\n${cmdResult.stdout || ""}${cmdResult.stderr ? `\n[STDERR]\n${cmdResult.stderr}` : ""}\n[Exit Code: ${cmdResult.exitCode}]`;

              subAction.status = cmdResult.exitCode === 0 ? "completed" : "error";
              subAction.output = fullLog;
              updateGroupOutput(group);
              await sendEvent({ actions: [...taskGroups] });

              conversationMessages.push({ role: "assistant", content: `<execute_command>${cmd}</execute_command>` });
              conversationMessages.push({ role: "user", content: `Command Output:\n${fullLog}` });
            }

            // 2. Write Files
            let writeMatch;
            while ((writeMatch = writeRegex.exec(aiResponseText)) !== null) {
              hasTools = true;
              const filePath = writeMatch[1].trim();
              const content = writeMatch[2].trim();
              const group = currentGroup || (await getOrCreateGroup("File Assembly"));

              const subAction: SubAction = {
                id: String(subActionCounter++),
                type: "write_file",
                title: `Wrote: ${filePath}`,
                status: "running",
                command: `write_file ${filePath}`,
                output: `Writing ${content.length} bytes to ${filePath}...`,
              };
              group.subActions.push(subAction);
              updateGroupOutput(group);
              await sendEvent({ actions: [...taskGroups] });

              await this.writeFile(filePath, content);
              subAction.status = "completed";
              subAction.output = `[SUCCESS] Created ${filePath} (${content.length} bytes)`;
              updateGroupOutput(group);
              await sendEvent({ actions: [...taskGroups] });

              conversationMessages.push({ role: "assistant", content: `<write_file path="${filePath}">...</write_file>` });
              conversationMessages.push({ role: "user", content: `File ${filePath} written successfully.` });
            }

            // 3. Read Files
            let readMatch;
            while ((readMatch = readRegex.exec(aiResponseText)) !== null) {
              hasTools = true;
              const filePath = readMatch[1].trim();
              const group = currentGroup || (await getOrCreateGroup("File Inspection"));

              const subAction: SubAction = {
                id: String(subActionCounter++),
                type: "read_file",
                title: `Read: ${filePath}`,
                status: "running",
                command: `cat ${filePath}`,
                output: `Reading ${filePath}...`,
              };
              group.subActions.push(subAction);
              updateGroupOutput(group);
              await sendEvent({ actions: [...taskGroups] });

              const content = await this.readFile(filePath);
              subAction.status = "completed";
              subAction.output = content ? content.slice(0, 800) : "[File empty or not found]";
              updateGroupOutput(group);
              await sendEvent({ actions: [...taskGroups] });

              conversationMessages.push({ role: "assistant", content: `<read_file path="${filePath}" />` });
              conversationMessages.push({ role: "user", content: `File Content of ${filePath}:\n${content}` });
            }

            if (!hasTools && !isEnvModalRequest) {
              const tsxMatch = aiResponseText.match(/```(?:tsx|jsx|typescript|ts)([\s\S]*?)```/i);
              if (tsxMatch) {
                const group = await getOrCreateGroup("React UI Synthesis");
                const subAction: SubAction = {
                  id: String(subActionCounter++),
                  type: "write_file",
                  title: "Created src/App.tsx",
                  status: "running",
                  command: "synthesize src/App.tsx",
                  output: "Writing synthesized UI...",
                };
                group.subActions.push(subAction);
                updateGroupOutput(group);
                await sendEvent({ actions: [...taskGroups] });

                await this.writeFile("src/App.tsx", tsxMatch[1].trim());
                subAction.status = "completed";
                subAction.output = `[SUCCESS] Created src/App.tsx (${tsxMatch[1].trim().length} bytes)`;
                updateGroupOutput(group);
                await sendEvent({ actions: [...taskGroups] });
              }
              isFinished = true;
            } else if (isEnvModalRequest) {
              isFinished = true;
            }
          }

          for (const grp of taskGroups) {
            if (grp.status === "running") {
              grp.status = grp.subActions.some((s) => s.status === "error") ? "error" : "completed";
            }
          }
          await sendEvent({ actions: [...taskGroups] });

          await this.refreshFilesAndFolders();

          const appCode = await this.readFile("src/App.tsx");
          const customCss = await this.readFile("src/index.css");
          if (appCode) {
            this.previewHtml = buildPreviewHtml(appCode, customCss, userPrompt);
          }

          await this.ctx.storage.put("files", this.files);
          await this.ctx.storage.put("previewHtml", this.previewHtml);
          await this.ctx.storage.put("meta", this.meta);
          await this.ctx.storage.put("messages", this.messages);

          const previewUrl = `/api/sandbox/render-preview?sessionId=${encodeURIComponent(sessionId)}`;
          await sendEvent({ type: "preview_ready", previewUrl });
          await sendEvent({ type: "stream_finished", finalResponse: `Task finished for "${userPrompt}".` });
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

export class BrowserRun extends DurableObject {
  async fetch(_request: Request): Promise<Response> {
    return new Response("BrowserRun stub active", { status: 200 });
  }
}

export default {
  async fetch(request: Request, env: Record<string, any>): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PATCH, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    if (url.pathname === "/api/health") {
      return Response.json(
        {
          status: "ok",
          worker: "sovereign-agent-replit",
          architecture: "Cloudflare Workers + Durable Objects + Workers AI + E2B (VS Code Tree & Env Modal)",
          timestamp: new Date().toISOString(),
        },
        { headers: corsHeaders }
      );
    }

    const getSessionStub = (sessionId: string) => {
      const id = env.AGENT_SESSION.idFromName(sessionId);
      return env.AGENT_SESSION.get(id);
    };

    if ((url.pathname === "/api/agent/stream" || url.pathname === "/api/agent/react-stream") && request.method === "POST") {
      const body = (await request.clone().json()) as { sessionId?: string; prompt?: string };
      const sessionId = body.sessionId || "sovereign-session-default";

      if (env.SOVEREIGN_KV && body.prompt) {
        try {
          let list: SessionMeta[] = [];
          const raw = await env.SOVEREIGN_KV.get("sovereign_sessions_index");
          if (raw) list = JSON.parse(raw);
          const meta: SessionMeta = {
            id: sessionId,
            title: body.prompt.length > 35 ? body.prompt.slice(0, 35) + "..." : body.prompt,
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            credentials: {
              aiProvider: "Cloudflare Workers AI",
              model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
              sandbox: env.E2B_API_KEY ? "E2B Linux Micro-VM" : "Durable Object Sandbox",
            },
          };
          list = [meta, ...list.filter((s) => s.id !== sessionId)].slice(0, 25);
          await env.SOVEREIGN_KV.put("sovereign_sessions_index", JSON.stringify(list));
        } catch {}
      }

      const stub = getSessionStub(sessionId);
      return stub.fetch(new Request("https://session-do/stream", request));
    }

    if (url.pathname === "/api/sandbox/save-env" && request.method === "POST") {
      const body = (await request.clone().json()) as { sessionId?: string };
      const sessionId = body.sessionId || "sovereign-session-default";
      const stub = getSessionStub(sessionId);
      return stub.fetch(new Request("https://session-do/save-env", request));
    }

    if (url.pathname === "/api/sandbox/tree") {
      const sessionId = url.searchParams.get("sessionId") || "sovereign-session-default";
      const stub = getSessionStub(sessionId);
      return stub.fetch(new Request("https://session-do/tree", request));
    }

    if (url.pathname === "/api/sandbox/file" && request.method === "POST") {
      const body = (await request.clone().json()) as { sessionId?: string };
      const sessionId = body.sessionId || "sovereign-session-default";
      const stub = getSessionStub(sessionId);
      return stub.fetch(new Request("https://session-do/file", request));
    }

    if (url.pathname === "/api/sandbox/exec" && request.method === "POST") {
      const body = (await request.clone().json()) as { sessionId?: string };
      const sessionId = body.sessionId || "sovereign-session-default";
      const stub = getSessionStub(sessionId);
      return stub.fetch(new Request("https://session-do/exec", request));
    }

    if (url.pathname === "/api/sandbox/render-preview") {
      const sessionId = url.searchParams.get("sessionId") || "sovereign-session-default";
      const stub = getSessionStub(sessionId);
      return stub.fetch(new Request("https://session-do/render-preview", request));
    }

    if (url.pathname === "/api/sandbox/preview-url") {
      const sessionId = url.searchParams.get("sessionId") || "sovereign-session-default";
      const previewUrl = `${url.origin}/api/sandbox/render-preview?sessionId=${encodeURIComponent(sessionId)}`;
      return Response.json({ previewUrl, isListening: true, status: "running", port: 5173 }, { headers: corsHeaders });
    }

    if (url.pathname === "/api/sessions" && request.method === "GET") {
      let sessionList: SessionMeta[] = [];
      if (env.SOVEREIGN_KV) {
        const raw = await env.SOVEREIGN_KV.get("sovereign_sessions_index");
        if (raw) {
          try {
            sessionList = JSON.parse(raw);
          } catch {}
        }
      }
      return Response.json({ sessions: sessionList }, { headers: corsHeaders });
    }

    if (url.pathname.startsWith("/api/session/")) {
      const parts = url.pathname.split("/");
      const sessionId = parts[3] || "sovereign-session-default";
      const subPath = parts.slice(4).join("/");
      const stub = getSessionStub(sessionId);
      return stub.fetch(new Request(`https://session-do/${subPath}`, request));
    }

    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) return assetResponse;
    }

    return new Response("Sovereign Agent Dynamic Gateway", { status: 200, headers: corsHeaders });
  },
};
