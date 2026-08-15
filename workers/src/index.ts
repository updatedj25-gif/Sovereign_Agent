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

export interface ActionStep {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "error";
  command: string;
  output: string;
}

const SYSTEM_PROMPT = `You are Sovereign Agent, an autonomous software engineer running inside a real E2B Linux Micro-VM.

You solve tasks dynamically by invoking tools:

AVAILABLE TOOLS:
1. Execute any bash command:
<execute_command>
git clone https://github.com/user/repo.git .
</execute_command>

2. Write file:
<write_file path="src/App.tsx">
// Complete Code
</write_file>

3. Read file:
<read_file path="package.json" />

4. List directory:
<execute_command>
ls -la
</execute_command>

RULES:
- When asked to clone a repository, clone it and inspect the files.
- When creating UI components, provide complete React 19 + Tailwind CSS code in src/App.tsx.
- Provide a clear, helpful final response when finished.`;

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
  private files: Record<string, string> = {};
  private previewHtml: string = "";
  private e2bSandboxId: string | null = null;
  private env: Record<string, any>;

  constructor(ctx: DurableObjectState, env: Record<string, any>) {
    super(ctx, env);
    this.env = env;
    this.ctx.blockConcurrencyWhile(async () => {
      const storedMsgs = await this.ctx.storage.get<ReActMessage[]>("messages");
      const storedMeta = await this.ctx.storage.get<SessionMeta>("meta");
      const storedFiles = await this.ctx.storage.get<Record<string, string>>("files");
      const storedPreview = await this.ctx.storage.get<string>("previewHtml");
      const storedSandboxId = await this.ctx.storage.get<string>("e2bSandboxId");

      if (storedMsgs) this.messages = storedMsgs;
      if (storedMeta) this.meta = storedMeta;
      if (storedFiles) this.files = storedFiles;
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
      console.log(`[E2B] Sandbox created: ${this.e2bSandboxId}`);
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
    this.files[path] = content;
    const sbx = await this.getSandboxInstance();
    if (sbx) {
      try {
        await sbx.files.write(path, content);
      } catch (err: any) {
        console.error(`[E2B Write Error ${path}]:`, err.message);
      }
    }
  }

  public async readFile(path: string): Promise<string> {
    const sbx = await this.getSandboxInstance();
    if (sbx) {
      try {
        const catRes = await this.runCommand(`cat "${path}"`);
        if (catRes.exitCode === 0 && catRes.stdout) {
          this.files[path] = catRes.stdout;
          return catRes.stdout;
        }
      } catch {}
    }
    return this.files[path] || "";
  }

  /**
   * Recursively scans VM for real project files
   */
  public async refreshFilesFromVM(): Promise<void> {
    const findRes = await this.runCommand(
      "find . -maxdepth 4 -type f -not -path '*/.*' -not -path '*node_modules*' -not -path '*/dist/*' -not -name '.bash*' -not -name '.profile'"
    );

    if (findRes.exitCode === 0 && findRes.stdout) {
      const paths = findRes.stdout.split("\n").filter((p) => p.trim() && p !== ".");
      for (const rawPath of paths) {
        const cleanPath = rawPath.replace(/^\.\//, "");
        if (!this.files[cleanPath]) {
          this.files[cleanPath] = "// synchronized from VM";
        }
      }
    }
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
      return Response.json({ meta: this.meta, messages: this.messages }, { headers: corsHeaders });
    }

    // 1. Recursive File Explorer Tree
    if (url.pathname.endsWith("/tree") && request.method === "GET") {
      await this.refreshFilesFromVM();

      // Filter out hidden dotfiles and map to file tree
      const filteredKeys = Object.keys(this.files).filter(
        (p) => !p.startsWith(".") && !p.includes("/.") && p !== ".bashrc" && p !== ".profile" && p !== ".bash_logout"
      );

      let fileList = filteredKeys.map((p) => ({
        name: p.split("/").pop() || p,
        path: p,
        type: "file",
      }));

      if (fileList.length === 0) {
        fileList = [
          { name: "App.tsx", path: "src/App.tsx", type: "file" },
          { name: "index.css", path: "src/index.css", type: "file" },
          { name: "index.html", path: "index.html", type: "file" },
          { name: "package.json", path: "package.json", type: "file" },
        ];
      }

      return Response.json({ tree: fileList }, { headers: corsHeaders });
    }

    // 2. File Content Reader
    if (url.pathname.endsWith("/file") && request.method === "POST") {
      const body = (await request.json()) as { filePath?: string };
      const path = body.filePath || "src/App.tsx";
      const content = await this.readFile(path);
      return Response.json({ content: content || "// File empty" }, { headers: corsHeaders });
    }

    // 3. Terminal Exec
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

    // 4. Render Live Preview
    if (url.pathname.endsWith("/render-preview")) {
      const html = this.previewHtml || buildPreviewHtml(this.files["src/App.tsx"] || "", this.files["src/index.css"] || "", "Live Preview");
      return new Response(html, { headers: { "Content-Type": "text/html; charset=UTF-8", ...corsHeaders } });
    }

    // 5. Dynamic ReAct Stream
    if (url.pathname.endsWith("/stream") && request.method === "POST") {
      const body = (await request.json()) as { prompt?: string; sessionId?: string };
      const userPrompt = body.prompt || "Run task";
      const sessionId = body.sessionId || "sovereign-session-default";

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
          const dynamicActions: ActionStep[] = [];
          let actionCounter = 1;

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

            const cmdRegex = /<execute_command>([\s\S]*?)<\/execute_command>/gi;
            const writeRegex = /<write_file\s+path=["']([^"']+)["']>([\s\S]*?)<\/write_file>/gi;
            const readRegex = /<read_file\s+path=["']([^"']+)["']\s*\/>/gi;

            let hasTools = false;

            // Execute Commands
            let cmdMatch;
            while ((cmdMatch = cmdRegex.exec(aiResponseText)) !== null) {
              hasTools = true;
              const cmd = cmdMatch[1].trim();
              const actionId = String(actionCounter++);
              const action: ActionStep = {
                id: actionId,
                title: `Execute: $ ${cmd.split("\n")[0].slice(0, 45)}`,
                status: "running",
                command: cmd,
                output: `$ ${cmd}\n[E2B VM] Executing in micro-VM...\n`,
              };
              dynamicActions.push(action);
              await sendEvent({ actions: [...dynamicActions] });

              const cmdResult = await this.runCommand(cmd);
              const fullLog = `$ ${cmd}\n${cmdResult.stdout || ""}${cmdResult.stderr ? `\n[STDERR]\n${cmdResult.stderr}` : ""}\n[Exit Code: ${cmdResult.exitCode}]`;

              action.status = cmdResult.exitCode === 0 ? "completed" : "error";
              action.output = fullLog;
              await sendEvent({ actions: [...dynamicActions] });

              conversationMessages.push({ role: "assistant", content: `<execute_command>${cmd}</execute_command>` });
              conversationMessages.push({ role: "user", content: `Command Output:\n${fullLog}` });
            }

            // Write Files
            let writeMatch;
            while ((writeMatch = writeRegex.exec(aiResponseText)) !== null) {
              hasTools = true;
              const filePath = writeMatch[1].trim();
              const content = writeMatch[2].trim();
              const actionId = String(actionCounter++);
              const action: ActionStep = {
                id: actionId,
                title: `Write File: ${filePath}`,
                status: "running",
                command: `write_file ${filePath}`,
                output: `Writing ${content.length} bytes to ${filePath}...`,
              };
              dynamicActions.push(action);
              await sendEvent({ actions: [...dynamicActions] });

              await this.writeFile(filePath, content);
              action.status = "completed";
              action.output = `[SUCCESS] Created ${filePath} (${content.length} bytes)`;
              await sendEvent({ actions: [...dynamicActions] });

              conversationMessages.push({ role: "assistant", content: `<write_file path="${filePath}">...</write_file>` });
              conversationMessages.push({ role: "user", content: `File ${filePath} written successfully.` });
            }

            // Read Files
            let readMatch;
            while ((readMatch = readRegex.exec(aiResponseText)) !== null) {
              hasTools = true;
              const filePath = readMatch[1].trim();
              const actionId = String(actionCounter++);
              const action: ActionStep = {
                id: actionId,
                title: `Read File: ${filePath}`,
                status: "running",
                command: `cat ${filePath}`,
                output: `Reading ${filePath}...`,
              };
              dynamicActions.push(action);
              await sendEvent({ actions: [...dynamicActions] });

              const content = await this.readFile(filePath);
              action.status = "completed";
              action.output = content ? content.slice(0, 800) : "[File empty or not found]";
              await sendEvent({ actions: [...dynamicActions] });

              conversationMessages.push({ role: "assistant", content: `<read_file path="${filePath}" />` });
              conversationMessages.push({ role: "user", content: `File Content of ${filePath}:\n${content}` });
            }

            if (!hasTools) {
              const tsxMatch = aiResponseText.match(/```(?:tsx|jsx|typescript|ts)([\s\S]*?)```/i);
              if (tsxMatch) {
                const actionId = String(actionCounter++);
                const action: ActionStep = {
                  id: actionId,
                  title: `Generate Component: src/App.tsx`,
                  status: "running",
                  command: "synthesize src/App.tsx",
                  output: "Writing synthesized UI component...",
                };
                dynamicActions.push(action);
                await sendEvent({ actions: [...dynamicActions] });

                await this.writeFile("src/App.tsx", tsxMatch[1].trim());
                action.status = "completed";
                action.output = `[SUCCESS] Created src/App.tsx`;
                await sendEvent({ actions: [...dynamicActions] });
              }
              isFinished = true;
            }
          }

          // Scan VM and update File Explorer Tree
          await this.refreshFilesFromVM();

          // Auto-detect App.tsx anywhere in workspace (root or cloned repos)
          let appCode = await this.readFile("src/App.tsx");
          if (!appCode) {
            const possibleAppPaths = Object.keys(this.files).filter((p) => p.endsWith("App.tsx") || p.endsWith("App.jsx"));
            if (possibleAppPaths.length > 0) {
              appCode = await this.readFile(possibleAppPaths[0]);
            }
          }

          let customCss = await this.readFile("src/index.css");
          if (!customCss) {
            const possibleCss = Object.keys(this.files).filter((p) => p.endsWith("index.css") || p.endsWith("App.css"));
            if (possibleCss.length > 0) customCss = await this.readFile(possibleCss[0]);
          }

          if (appCode) {
            this.previewHtml = buildPreviewHtml(appCode, customCss, userPrompt);
          }

          await this.ctx.storage.put("files", this.files);
          await this.ctx.storage.put("previewHtml", this.previewHtml);
          await this.ctx.storage.put("meta", this.meta);
          await this.ctx.storage.put("messages", this.messages);

          if (this.env.SOVEREIGN_KV) {
            await this.env.SOVEREIGN_KV.put(`preview_html_${sessionId}`, this.previewHtml);
            for (const [p, c] of Object.entries(this.files)) {
              await this.env.SOVEREIGN_KV.put(`code_${sessionId}_${p}`, c);
            }
          }

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
          architecture: "Cloudflare Workers + Durable Objects + Workers AI + Official E2B SDK",
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

    if (url.pathname === "/api/sandbox/exec" && request.method === "POST") {
      const body = (await request.clone().json()) as { sessionId?: string };
      const sessionId = body.sessionId || "sovereign-session-default";
      const stub = getSessionStub(sessionId);
      return stub.fetch(new Request("https://session-do/exec", request));
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
