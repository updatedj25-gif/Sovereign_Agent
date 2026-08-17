import { DurableObject } from "cloudflare:workers";
import { AgentSession } from "./session";
import { SessionMeta } from "./types";

export { AgentSession };

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
          architecture: "Modular Cloudflare Workers + Durable Objects + E2B Micro-VM",
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
      const previewUrl = `${url.origin}/api/sandbox/render-preview?sessionId=${encodeURIComponent(sessionId)}&t=${Date.now()}`;
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

    return new Response("Sovereign Agent Modular Gateway", { status: 200, headers: corsHeaders });
  },
};
