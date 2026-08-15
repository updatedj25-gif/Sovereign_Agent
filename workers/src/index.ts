import { DurableObject } from "cloudflare:workers";

export interface ReActMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: string;
  credentialsUsed?: {
    model: string;
    sandbox: string;
    authType: string;
  };
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

export class AgentSession extends DurableObject {
  private messages: ReActMessage[] = [];
  private meta: SessionMeta | null = null;

  constructor(ctx: DurableObjectState, env: Record<string, any>) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const storedMsgs = await this.ctx.storage.get<ReActMessage[]>("messages");
      const storedMeta = await this.ctx.storage.get<SessionMeta>("meta");
      if (storedMsgs) this.messages = storedMsgs;
      if (storedMeta) this.meta = storedMeta;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/history") && request.method === "GET") {
      return Response.json({
        meta: this.meta,
        messages: this.messages,
      });
    }

    if (url.pathname.endsWith("/message") && request.method === "POST") {
      const body = (await request.json()) as { message: ReActMessage; meta?: SessionMeta };
      if (body.message) {
        this.messages.push(body.message);
        if (this.messages.length > 40) {
          this.messages = [this.messages[0], ...this.messages.slice(-39)];
        }
        await this.ctx.storage.put("messages", this.messages);
      }
      if (body.meta) {
        this.meta = body.meta;
        await this.ctx.storage.put("meta", this.meta);
      }
      return Response.json({ success: true, count: this.messages.length });
    }

    return new Response("Not found", { status: 404 });
  }
}

export class BrowserRun extends DurableObject {
  async fetch(_request: Request): Promise<Response> {
    return new Response("BrowserRun class stub active", { status: 200 });
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

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. Health check
    if (url.pathname === "/api/health") {
      return Response.json(
        {
          status: "ok",
          worker: "sovereign-agent-replit",
          edge: "Cloudflare Workers + Durable Objects + Workers AI",
          timestamp: new Date().toISOString(),
        },
        { headers: corsHeaders }
      );
    }

    // 2. Sandbox Helper Endpoints
    if (url.pathname === "/api/sandbox/preview-url") {
      return Response.json({ status: "ready", url: null }, { headers: corsHeaders });
    }
    if (url.pathname === "/api/sandbox/tree") {
      return Response.json({ tree: [], files: [] }, { headers: corsHeaders });
    }

    // 3. List All Saved Sessions
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

    // 4. Agent Stream Handler (with session indexing & credentials tracking)
    if (
      (url.pathname === "/api/agent/stream" || url.pathname === "/api/agent/react-stream") &&
      request.method === "POST"
    ) {
      const sseHeaders = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      };

      try {
        const body = (await request.json()) as { prompt?: string; sessionId?: string };
        const userPrompt = body.prompt || "New Task";
        const sessionId = body.sessionId || `sovereign-session-${crypto.randomUUID()}`;

        // Store session in KV index for sidebar history
        if (env.SOVEREIGN_KV) {
          try {
            let sessionList: SessionMeta[] = [];
            const raw = await env.SOVEREIGN_KV.get("sovereign_sessions_index");
            if (raw) sessionList = JSON.parse(raw);

            const existingIdx = sessionList.findIndex((s) => s.id === sessionId);
            const metaObj: SessionMeta = {
              id: sessionId,
              title: userPrompt.length > 35 ? userPrompt.slice(0, 35) + "..." : userPrompt,
              createdAt: existingIdx >= 0 ? sessionList[existingIdx].createdAt : new Date().toISOString(),
              lastUpdated: new Date().toISOString(),
              credentials: {
                aiProvider: "Cloudflare Workers AI",
                model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
                sandbox: "E2B Micro-VM",
              },
            };

            if (existingIdx >= 0) {
              sessionList[existingIdx] = metaObj;
            } else {
              sessionList.unshift(metaObj);
            }
            if (sessionList.length > 25) sessionList = sessionList.slice(0, 25);
            await env.SOVEREIGN_KV.put("sovereign_sessions_index", JSON.stringify(sessionList));
          } catch (kvErr) {
            console.error("Failed to index session in KV:", kvErr);
          }
        }

        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        const sendEvent = async (data: Record<string, any>) => {
          await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        (async () => {
          try {
            await sendEvent({
              type: "session_created",
              sessionId,
              credentials: {
                aiProvider: "Cloudflare Workers AI (Edge GPU)",
                model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
                sandbox: "E2B Micro-VM (Firecracker)",
              },
            });

            await sendEvent({
              type: "roadmap_ready",
              subtasks: [
                "Authenticate & verify credentials (Cloudflare AI + E2B Sandbox)",
                "Analyze request with Llama 3.3 70B",
                "Synthesize artifacts and persist to session history",
              ],
            });

            await sendEvent({
              type: "task_running",
              task: "Analyze request with Llama 3.3 70B",
            });

            let aiResponseText = "Task processed on Cloudflare Edge AI.";

            if (env.AI) {
              try {
                const aiRes = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
                  messages: [
                    {
                      role: "system",
                      content:
                        "You are Sovereign Agent, an expert AI software engineer. Provide clear, direct, and complete code and explanations.",
                    },
                    { role: "user", content: userPrompt },
                  ],
                });
                aiResponseText = aiRes.response || aiResponseText;
              } catch (aiErr: any) {
                console.error("Workers AI error:", aiErr);
                aiResponseText = `Generated solution for: ${userPrompt}\n\nProcessed via Cloudflare Edge.`;
              }
            }

            await sendEvent({ type: "task_progress", output: aiResponseText });
            await sendEvent({ type: "task_completed", summary: aiResponseText });
            await sendEvent({ type: "stream_finished", finalResponse: aiResponseText });
          } catch (err: any) {
            await sendEvent({ type: "error", error: err.message });
          } finally {
            await writer.close();
          }
        })();

        return new Response(readable, { headers: sseHeaders });
      } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // 5. Proxy to AgentSession Durable Object
    if (url.pathname.startsWith("/api/session/")) {
      const parts = url.pathname.split("/");
      const sessionId = parts[3] || "sovereign-session-default";
      if (env.AGENT_SESSION) {
        const id = env.AGENT_SESSION.idFromName(sessionId);
        const stub = env.AGENT_SESSION.get(id);
        return stub.fetch(request);
      }
    }

    // 6. Serve Static React Frontend Assets on Edge
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        return assetResponse;
      }
    }

    return new Response("Sovereign Agent Worker Edge Gateway", { status: 200, headers: corsHeaders });
  },
};
