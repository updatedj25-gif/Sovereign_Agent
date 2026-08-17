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
  type: "command" | "python" | "write_file" | "read_file" | "thought" | "env_box";
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

const SYSTEM_PROMPT = `You are Sovereign Agent, a Senior Staff Software Engineer running inside an E2B Linux VM.

AVAILABLE TOOLS:
1. Write file (ALWAYS specify clean relative paths without leading slashes or /home/user):
<write_file path="folder_name/filename.ext">
// Code content
</write_file>

2. Execute bash command:
<execute_command>
mkdir -p folder_name && echo '{"status":"ok"}' > folder_name/config.json
</execute_command>

3. Execute Python 3:
<execute_python>
import json, os
os.makedirs("folder_name", exist_ok=True)
with open("folder_name/config.json", "w") as f:
    json.dump({"status": "ok"}, f, indent=2)
print("Saved config")
</execute_python>

4. Read file:
<read_file path="folder_name/filename.ext" />

CRITICAL RULES:
- Never use "/home/user/" or leading slashes in <write_file path="...">. Use relative paths like "test_app/config.json" or "src/App.tsx".
- Never create a folder named "it", "this", or "folder". Use the exact folder name requested by the user (e.g. "test_app").
- When asked to create a Vite app, run: "npm create vite@latest <name> -- --template react-ts --yes".`;

function cleanPath(raw: string): string {
  let p = raw.trim();
  p = p.replace(/^\/home\/user\/?/i, "");
  p = p.replace(/^\.\//, "");
  p = p.replace(/^\/+/, "");
  p = p.replace(/^it\//i, ""); // Clean any accidental "it/" prefixes
  return p;
}

function cleanBlockContent(raw: string): string {
  let clean = raw.trim();
  clean = clean.replace(/^```(?:python|py|bash|sh|javascript|js|tsx|ts|json|html|css)?\s*\n?/i, "");
  clean = clean.replace(/\n?```\s*$/i, "");
  return clean.trim();
}

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
    if (!["React", "ReactDOM", "View", "Text", "TouchableOpacity", "TextInput", "ScrollView", "Image", "StyleSheet"].includes(m[1])) {
      declaredComponents.push(m[1]);
    }
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
    body { margin: 0; padding: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #030712; }
    ${cleanCss}
  </style>
</head>
<body class="bg-slate-950 text-white min-h-screen flex items-center justify-center p-4">
  <div id="root" class="w-full flex items-center justify-center"></div>
  <div id="preview-error" class="hidden m-4 p-4 rounded-xl bg-red-950/90 border border-red-500/50 text-red-200 font-mono text-xs whitespace-pre-wrap"></div>
  
  <script type="text/babel" data-presets="react,typescript">
    const { useState, useEffect, useRef, useMemo, useCallback, useReducer, useContext, createContext } = React;

    const View = (props) => <div {...props} className={props.className || ''} style={props.style}>{props.children}</div>;
    const Text = (props) => <span {...props} className={props.className || ''} style={props.style}>{props.children}</span>;
    const TouchableOpacity = (props) => <button {...props} className={props.className || ''} style={props.style} onClick={props.onPress || props.onClick}>{props.children}</button>;
    const TextInput = (props) => <input {...props} className={props.className || ''} style={props.style} onChange={(e) => props.onChangeText ? props.onChangeText(e.target.value) : (props.onChange && props.onChange(e))} />;
    const ScrollView = (props) => <div {...props} className={'overflow-y-auto ' + (props.className || '')} style={props.style}>{props.children}</div>;
    const Image = (props) => <img {...props} src={props.source?.uri || props.src || ''} className={props.className || ''} style={props.style} />;
    const StyleSheet = { create: (s) => s };

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

  public async runCommand(rawCmd: string): Promise<{ stdout: string; stderr: string; exitCode: number; mode: string }> {
    const cmd = cleanBlockContent(rawCmd);
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

  public async runPython(rawCode: string): Promise<{ stdout: string; stderr: string; exitCode: number; mode: string }> {
    const cleanPy = cleanBlockContent(rawCode);
    const b64 = btoa(unescape(encodeURIComponent(cleanPy)));
    const runScript = `mkdir -p /tmp && echo "${b64}" | base64 -d > /tmp/runner.py && python3 -u /tmp/runner.py`;
    return await this.runCommand(runScript);
  }

  public async writeFile(rawPath: string, rawContent: string): Promise<void> {
    const p = cleanPath(rawPath);
    const content = cleanBlockContent(rawContent);

    if (p.includes("/")) {
      const parentDir = p.substring(0, p.lastIndexOf("/"));
      this.files[parentDir] = { content: "", type: "directory" };
    }

    this.files[p] = { content, type: "file" };

    const sbx = await this.getSandboxInstance();
    if (sbx) {
      try {
        if (p.includes("/")) {
          const parentDir = p.substring(0, p.lastIndexOf("/"));
          await sbx.commands.run(`mkdir -p "${parentDir}"`);
        }
        await sbx.files.write(p, content);
      } catch (err: any) {
        console.error(`[E2B Write Error ${p}]:`, err.message);
      }
    }
  }

  public async readFile(rawPath: string): Promise<string> {
    const p = cleanPath(rawPath);

    if (this.files[p]?.type === "directory") {
      const childFiles = Object.keys(this.files).filter((k) => k.startsWith(p + "/") && k !== p);
      return `// Directory: ${p}\n// Files inside:\n${childFiles.map((c) => `//  - ${c}`).join("\n") || "//  (Empty directory)"}`;
    }

    if (this.files[p]?.content) return this.files[p].content;

    const sbx = await this.getSandboxInstance();
    if (sbx) {
      try {
        const catRes = await this.runCommand(`cat "${p}"`);
        if (catRes.exitCode === 0 && catRes.stdout) {
          this.files[p] = { content: catRes.stdout, type: "file" };
          return catRes.stdout;
        }
      } catch {}
    }
    return "";
  }

  /**
   * Scans VM and returns ALL files (with full paths) so explorer lists every file
   */
  public async getExplorerFileList(): Promise<any[]> {
    const scanScript = `node -e '
      const fs = require("fs");
      const path = require("path");
      function scan(dir) {
        let results = [];
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.name.startsWith(".") && e.name !== ".env") continue;
            if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
            const fullRel = path.join(dir, e.name).replace(/^\\.\\/?/, "");
            if (e.isDirectory()) {
              results.push({ name: fullRel, path: fullRel, type: "directory" });
              results = results.concat(scan(path.join(dir, e.name)));
            } else {
              results.push({ name: fullRel, path: fullRel, type: "file" });
            }
          }
        } catch (err) {}
        return results;
      }
      console.log(JSON.stringify(scan(".")));
    '`;

    const res = await this.runCommand(scanScript);
    if (res.exitCode === 0 && res.stdout) {
      try {
        const items = JSON.parse(res.stdout.trim());
        for (const item of items) {
          if (!this.files[item.path]) {
            this.files[item.path] = { content: "", type: item.type };
          }
        }
        // Filter out accidental "it" directories
        return items.filter((item: any) => !item.path.startsWith("it/") && item.path !== "it");
      } catch {}
    }

    return Object.entries(this.files)
      .filter(([p]) => !p.startsWith("it/") && p !== "it")
      .map(([p, v]) => ({
        name: p,
        path: p,
        type: v.type || "file",
      }));
  }

  public async autoSpinPreview(userPrompt: string): Promise<string> {
    let appCode = await this.readFile("src/App.tsx");
    let customCss = await this.readFile("src/index.css");

    if (!appCode) {
      const candidates = Object.keys(this.files).filter(
        (p) =>
          p.endsWith("App.tsx") ||
          p.endsWith("App.jsx") ||
          p.endsWith("App.js") ||
          p.endsWith("src.ts") ||
          p.endsWith("main.tsx") ||
          p.endsWith("index.html")
      );

      for (const candidate of candidates) {
        const content = await this.readFile(candidate);
        if (content && (content.includes("function") || content.includes("const") || content.includes("<") || content.includes("export"))) {
          appCode = content;
          break;
        }
      }
    }

    if (!customCss) {
      const cssCandidates = Object.keys(this.files).filter((p) => p.endsWith("index.css") || p.endsWith("App.css") || p.endsWith("styles.css"));
      if (cssCandidates.length > 0) {
        customCss = await this.readFile(cssCandidates[0]);
      }
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

    if (url.pathname.endsWith("/history") && request.method === "GET") {
      return Response.json({ meta: this.meta, messages: this.messages, envVars: this.envVars }, { headers: corsHeaders });
    }

    // 1. Explorer File List: Returns all files with full paths (e.g. test_app/config.json)
    if (url.pathname.endsWith("/tree") && request.method === "GET") {
      const tree = await this.getExplorerFileList();
      return Response.json({ tree }, { headers: corsHeaders });
    }

    // 2. File Reader: Loads exact file content from path
    if (url.pathname.endsWith("/file") && request.method === "POST") {
      const body = (await request.json()) as { filePath?: string };
      const path = cleanPath(body.filePath || "src/App.tsx");
      const content = await this.readFile(path);
      return Response.json({ content: content || "// Empty file" }, { headers: corsHeaders });
    }

    if (url.pathname.endsWith("/save-env") && request.method === "POST") {
      const body = (await request.json()) as { envVars: Record<string, string> };
      const newVars = body.envVars || {};
      this.envVars = { ...this.envVars, ...newVars };
      await this.ctx.storage.put("envVars", this.envVars);

      const envFileContent = Object.entries(this.envVars)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
      await this.writeFile(".env", envFileContent);

      return Response.json({ success: true, count: Object.keys(this.envVars).length, envVars: this.envVars }, { headers: corsHeaders });
    }

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

    if (url.pathname.endsWith("/render-preview")) {
      const html = this.previewHtml || buildPreviewHtml(this.files["src/App.tsx"]?.content || "", "", "Live Preview");
      return new Response(html, { headers: { "Content-Type": "text/html; charset=UTF-8", ...corsHeaders } });
    }

    if (url.pathname.endsWith("/stream") && request.method === "POST") {
      const body = (await request.json()) as { prompt?: string; sessionId?: string };
      const userPrompt = body.prompt || "Run task";
      const sessionId = body.sessionId || "sovereign-session-default";

      // Detect folder name (excluding pronouns like 'it', 'this')
      let targetFolder = "";
      const folderMatch = userPrompt.match(/named\s+([a-zA-Z0-9_-]+)|folder\s+([a-zA-Z0-9_-]+)/i);
      if (folderMatch) {
        const candidate = folderMatch[1] || folderMatch[2];
        if (!["it", "this", "that", "the", "a", "an", "folder"].includes(candidate.toLowerCase())) {
          targetFolder = candidate;
        }
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
              .map((s) => `${s.title}: ${s.status.toUpperCase()}`)
              .join("\n");
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
              };
              group.subActions.push(subAction);
              updateGroupOutput(group);
              await sendEvent({ actions: [...taskGroups] });

              const pyResult = await this.runPython(cleanPyCode);
              const fullLog = `>>> Python Output:\n${pyResult.stdout || ""}${pyResult.stderr ? `\n[PYTHON TRACEBACK / STDERR]\n${pyResult.stderr}` : ""}\n[Exit Code: ${pyResult.exitCode}]`;

              subAction.status = pyResult.exitCode === 0 ? "completed" : "error";
              subAction.output = fullLog;
              updateGroupOutput(group);
              await sendEvent({ actions: [...taskGroups] });

              conversationMessages.push({ role: "assistant", content: `<execute_python>${cleanPyCode}</execute_python>` });
              conversationMessages.push({ role: "user", content: `Python Execution Output:\n${fullLog}` });
            }

            // 2. Bash Execution
            let cmdMatch;
            while ((cmdMatch = cmdRegex.exec(aiResponseText)) !== null) {
              hasTools = true;
              let cmd = cleanBlockContent(cmdMatch[1]);

              const group = currentGroup || (await getOrCreateGroup("Workspace Operations"));
              const subAction: SubAction = {
                id: String(subActionCounter++),
                type: "command",
                title: `Ran: $ ${cmd.split("\n")[0].slice(0, 45)}`,
                status: "running",
                command: cmd,
                output: `$ ${cmd}\n[E2B VM] Executing in micro-VM...\n`,
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

            // 3. Write Files with Clean Path Logic
            let writeMatch;
            while ((writeMatch = writeRegex.exec(aiResponseText)) !== null) {
              hasTools = true;
              let rawFilePath = writeMatch[1].trim();
              const content = cleanBlockContent(writeMatch[2]);
              let filePath = cleanPath(rawFilePath);

              // Auto-prefix target folder if specified and omitted
              if (targetFolder && !filePath.startsWith(targetFolder + "/") && filePath !== ".env") {
                filePath = `${targetFolder}/${filePath}`;
              }

              const group = currentGroup || (await getOrCreateGroup("Directory & File Assembly"));
              const subAction: SubAction = {
                id: String(subActionCounter++),
                type: "write_file",
                title: `Created: ${filePath}`,
                status: "running",
                command: `write_file ${filePath}`,
                output: `Writing ${content.length} bytes to ${filePath}...`,
              };
              group.subActions.push(subAction);
              updateGroupOutput(group);
              await sendEvent({ actions: [...taskGroups] });

              await this.writeFile(filePath, content);
              if (filePath.endsWith("App.js") || filePath.endsWith("App.jsx") || filePath.endsWith("App.tsx") || filePath.endsWith("src.ts")) {
                await this.writeFile("src/App.tsx", content);
              }

              subAction.status = "completed";
              subAction.output = `[SUCCESS] Created ${filePath} (${content.length} bytes)`;
              updateGroupOutput(group);
              await sendEvent({ actions: [...taskGroups] });

              conversationMessages.push({ role: "assistant", content: `<write_file path="${filePath}">...</write_file>` });
              conversationMessages.push({ role: "user", content: `File ${filePath} written successfully.` });
            }

            // 4. Read Files
            let readMatch;
            while ((readMatch = readRegex.exec(aiResponseText)) !== null) {
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

            if (!hasTools) {
              isFinished = true;
            }
          }

          for (const grp of taskGroups) {
            if (grp.status === "running") {
              grp.status = grp.subActions.some((s) => s.status === "error") ? "error" : "completed";
            }
          }
          await sendEvent({ actions: [...taskGroups] });

          await this.getExplorerFileList();
          await this.autoSpinPreview(userPrompt);

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
          architecture: "Cloudflare Workers + Durable Objects + Workers AI + Direct File Explorer",
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

    // 1. File Explorer tree endpoint: returns flat list of all active files with their paths
    if (url.pathname === "/api/sandbox/tree") {
      const sessionId = url.searchParams.get("sessionId") || "sovereign-session-default";
      const stub = getSessionStub(sessionId);
      return stub.fetch(new Request("https://session-do/tree", request));
    }

    // 2. File content reader: returns the exact file content
    if (url.pathname === "/api/sandbox/file" && request.method === "POST") {
      const body = (await request.clone().json()) as { sessionId?: string };
      const sessionId = body.sessionId || "sovereign-session-default";
      const stub = getSessionStub(sessionId);
      return stub.fetch(new Request("https://session-do/file", request));
    }

    if (url.pathname === "/api/sandbox/save-env" && request.method === "POST") {
      const body = (await request.clone().json()) as { sessionId?: string };
      const sessionId = body.sessionId || "sovereign-session-default";
      const stub = getSessionStub(sessionId);
      return stub.fetch(new Request("https://session-do/save-env", request));
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

    return new Response("Sovereign Agent Direct Gateway", { status: 200, headers: corsHeaders });
  },
};
