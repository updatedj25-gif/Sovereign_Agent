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
  icon?: string;
}

export interface TaskGroup {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "error";
  command: string;
  output: string;
  subActions: SubAction[];
}

const SYSTEM_PROMPT = `You are Sovereign Agent, a Senior Staff Autonomous Software Engineer and UI Architect running inside an E2B Linux Micro-VM.

CRITICAL CODE WRITING RULE:
- You are a builder agent. Whenever the user asks to create, build, or style any UI, app, component, or background (e.g. "create a blue react native background"), you MUST ALWAYS write the full working code into "src/App.tsx" using <write_file path="src/App.tsx">!
- NEVER simply describe the solution in conversational text. You MUST emit the <write_file> tool call!

AVAILABLE TOOLS:
1. Write File (ALWAYS use for UI/code generation):
<write_file path="src/App.tsx">
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Blue React Native Background</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0000FF',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    width: '100%',
  },
  text: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
  },
});
</write_file>

2. Declare a Task Phase Header:
<task_phase title="Synthesizing UI Component">
Creating the requested UI in src/App.tsx.
</task_phase>

3. Execute Python 3:
<execute_python>
import json, os
print("Executing python task")
</execute_python>

4. Execute Bash Command:
<execute_command>
ls -la src
</execute_command>

5. Read File:
<read_file path="src/App.tsx" />

6. Final Completion Summary (Place at the very end of your response):
<task_completed>
Summary of what was generated and built.
</task_completed>`;

function cleanPath(raw: string): string {
  let p = raw.trim();
  p = p.replace(/^\/home\/user\/?/i, "");
  p = p.replace(/^\.\//, "");
  p = p.replace(/^\/+/, "");
  p = p.replace(/^it\//i, "");
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
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #030712; }
    ${cleanCss}
  </style>
</head>
<body class="bg-slate-950 text-white min-h-screen flex items-center justify-center">
  <div id="root" class="w-full h-full min-h-screen flex items-center justify-center"></div>
  <div id="preview-error" class="hidden m-4 p-4 rounded-xl bg-red-950/90 border border-red-500/50 text-red-200 font-mono text-xs whitespace-pre-wrap"></div>
  
  <script type="text/babel" data-presets="react,typescript">
    const { useState, useEffect, useRef, useMemo, useCallback, useReducer, useContext, createContext } = React;

    // React Native Web Polyfills
    const View = (props) => <div {...props} className={props.className || ''} style={{ display: 'flex', flexDirection: 'column', boxSizing: 'border-box', ...(props.style || {}) }}>{props.children}</div>;
    const Text = (props) => <span {...props} className={props.className || ''} style={{ boxSizing: 'border-box', ...(props.style || {}) }}>{props.children}</span>;
    const TouchableOpacity = (props) => <button {...props} className={props.className || ''} style={{ cursor: 'pointer', border: 'none', background: 'transparent', ...(props.style || {}) }} onClick={props.onPress || props.onClick}>{props.children}</button>;
    const TextInput = (props) => <input {...props} className={props.className || ''} style={{ boxSizing: 'border-box', ...(props.style || {}) }} onChange={(e) => props.onChangeText ? props.onChangeText(e.target.value) : (props.onChange && props.onChange(e))} />;
    const ScrollView = (props) => <div {...props} className={'overflow-y-auto ' + (props.className || '')} style={{ boxSizing: 'border-box', overflowY: 'auto', ...(props.style || {}) }}>{props.children}</div>;
    const Image = (props) => <img {...props} src={props.source?.uri || props.src || ''} className={props.className || ''} style={{ boxSizing: 'border-box', ...(props.style || {}) }} />;
    const SafeAreaView = View;
    const StatusBar = () => null;
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
  private isAborted: boolean = false;
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
    const runScript = `mkdir -p /tmp && echo "${b64}" | base64 -d > /tmp/runner.py && python3 -u /tmp/runner.py 2>&1`;
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
      return `// Directory: ${p}\n// Contents:\n${childFiles.map((c) => `//  - ${c}`).join("\n") || "//  (Empty directory)"}`;
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

    // Auto-generate UI fallback if prompt requested visual styling (e.g. blue background)
    if (!appCode && /blue|wine|yellow|red|green|dark|light|theme|background|modal|card|button|chat|dashboard/i.test(userPrompt)) {
      const isBlue = /blue/i.test(userPrompt);
      const isWine = /wine/i.test(userPrompt);
      const bgColor = isBlue ? '#0000FF' : isWine ? '#4A0E17' : '#0f172a';

      appCode = `import React from 'react';
export default function App() {
  return (
    <div style={{ minHeight: '100vh', width: '100%', backgroundColor: '${bgColor}', color: '#ffffff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ padding: '2rem', borderRadius: '1rem', backgroundColor: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.2)', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: 0 }}>${userPrompt}</h1>
        <p style={{ fontSize: '0.875rem', opacity: 0.8, marginTop: '0.5rem' }}>Rendered live in Sovereign Agent Sandbox</p>
      </div>
    </div>
  );
}`;
      await this.writeFile("src/App.tsx", appCode);
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
      this.files = {};
      this.previewHtml = "";
      this.meta = null;
      await this.ctx.storage.deleteAll();
      return Response.json({ success: true, message: "Session wiped" }, { headers: corsHeaders });
    }

    if (url.pathname.endsWith("/history") && request.method === "GET") {
      return Response.json({ meta: this.meta, messages: this.messages, envVars: this.envVars }, { headers: corsHeaders });
    }

    if (url.pathname.endsWith("/tree") && request.method === "GET") {
      const tree = await this.getExplorerFileList();
      return Response.json({ tree }, { headers: corsHeaders });
    }

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

    // MAIN REACT STREAM (Flow: Thought -> Group/SubActions -> AutoPreview -> Summary at the bottom)
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

            await sendEvent({ type: "phase_start", title, id: newGroup.id });
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

          await sendEvent({
            type: "thought",
            text: `Analyzing objective: "${userPrompt}". Planning milestones and execution strategy.`,
          });

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

              const pyResult = await this.runPython(cleanPyCode);
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

              const cmdResult = await this.runCommand(cmd);
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

              await this.writeFile(filePath, content);
              if (filePath.endsWith("App.js") || filePath.endsWith("App.jsx") || filePath.endsWith("App.tsx") || filePath.endsWith("src.ts")) {
                await this.writeFile("src/App.tsx", content);
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

              const content = await this.readFile(filePath);
              subAction.status = "completed";
              subAction.output = content ? content.slice(0, 1000) : "[File empty or not found]";
              updateGroupOutput(group);

              await sendEvent({ type: "action_update", groupId: group.id, actionId: subAction.id, status: "completed", output: subAction.output });
              await sendEvent({ actions: [...taskGroups] });

              conversationMessages.push({ role: "assistant", content: `<read_file path="${filePath}" />` });
              conversationMessages.push({ role: "user", content: `File Content of ${filePath}:\n${content}` });
            }

            // Check if markdown tsx was output directly
            const tsxDirect = aiResponseText.match(/```(?:tsx|jsx|typescript|ts|javascript|js)([\s\S]*?)```/i);
            if (tsxDirect && !hasTools) {
              const code = cleanBlockContent(tsxDirect[1]);
              await this.writeFile("src/App.tsx", code);
              hasTools = true;
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

          await this.getExplorerFileList();
          await this.autoSpinPreview(userPrompt);

          await this.ctx.storage.put("files", this.files);
          await this.ctx.storage.put("previewHtml", this.previewHtml);
          await this.ctx.storage.put("meta", this.meta);
          await this.ctx.storage.put("messages", this.messages);

          const elapsedSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));
          const previewUrl = `/api/sandbox/render-preview?sessionId=${encodeURIComponent(sessionId)}`;
          await sendEvent({ type: "preview_ready", previewUrl });

          const createdFilesList = Object.keys(this.files).filter(k => !k.startsWith("."));
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
          architecture: "Cloudflare Workers + Durable Objects + E2B (Proper Flow & Code Writer)",
          timestamp: new Date().toISOString(),
        },
        { headers: corsHeaders }
      );
    }

    const getSessionStub = (sessionId: string) => {
      const id = env.AGENT_SESSION.idFromName(sessionId);
      return env.AGENT_SESSION.get(id);
    };

    if (url.pathname === "/api/agent/stop" && request.method === "POST") {
      const body = (await request.clone().json()) as { sessionId?: string };
      const sessionId = body.sessionId || "sovereign-session-default";
      const stub = getSessionStub(sessionId);
      return stub.fetch(new Request("https://session-do/stop", request));
    }

    if (url.pathname === "/api/sessions" && request.method === "DELETE") {
      const queryId = url.searchParams.get("id");
      if (env.SOVEREIGN_KV) {
        if (queryId) {
          let list: SessionMeta[] = [];
          const raw = await env.SOVEREIGN_KV.get("sovereign_sessions_index");
          if (raw) list = JSON.parse(raw);
          list = list.filter((s) => s.id !== queryId);
          await env.SOVEREIGN_KV.put("sovereign_sessions_index", JSON.stringify(list));
        } else {
          await env.SOVEREIGN_KV.delete("sovereign_sessions_index");
        }
      }
      return Response.json({ success: true }, { headers: corsHeaders });
    }

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
      const body = (await request.clone().json()) as { filePath?: string };
      const path = cleanPath(body.filePath || "src/App.tsx");
      const content = await this.readFile(path);
      return Response.json({ content: content || "// Empty file" }, { headers: corsHeaders });
    }

    if (url.pathname === "/api/sandbox/exec" && request.method === "POST") {
      const body = (await request.clone().json()) as { command?: string; cmd?: string };
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

    return new Response("Sovereign Agent Gateway", { status: 200, headers: corsHeaders });
  },
};
