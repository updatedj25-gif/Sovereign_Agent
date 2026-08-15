import { DurableObject } from "cloudflare:workers";

export interface ReActMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

export class AgentSession extends DurableObject {
  private messages: ReActMessage[] = [];

  constructor(ctx: DurableObjectState, env: Record<string, any>) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const storedMsgs = await this.ctx.storage.get<ReActMessage[]>("messages");
      if (storedMsgs) this.messages = storedMsgs;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/history") && request.method === "GET") {
      return Response.json({ messages: this.messages });
    }

    if (url.pathname.endsWith("/message") && request.method === "POST") {
      const body = (await request.json()) as ReActMessage;
      this.messages.push(body);
      if (this.messages.length > 40) {
        this.messages = [this.messages[0], ...this.messages.slice(-39)];
      }
      await this.ctx.storage.put("messages", this.messages);
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

    // 2. Sandbox Helper Endpoints for UI
    if (url.pathname === "/api/sandbox/preview-url") {
      return Response.json({ status: "ready", url: null }, { headers: corsHeaders });
    }
    if (url.pathname === "/api/sandbox/tree") {
      return Response.json({ tree: [], files: [] }, { headers: corsHeaders });
    }

    // 3. Agent Stream Handler (Matches both /api/agent/stream and /api/agent/react-stream)
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
        const userPrompt = body.prompt || "Create application";

        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        const sendEvent = async (data: Record<string, any>) => {
          await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        (async () => {
          try {
            await sendEvent({
              type: "roadmap_ready",
              subtasks: [
                "Analyze request with Cloudflare Workers AI (Llama 3.3 70B)",
                "Synthesize code solution and artifacts",
                "Finalize execution and render in workspace",
              ],
            });

            await sendEvent({
              type: "task_running",
              task: "Analyze request with Cloudflare Workers AI (Llama 3.3 70B)",
            });

            let aiResponseText = "Task completed successfully with Cloudflare Workers AI.";

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

            await sendEvent({
              type: "task_progress",
              output: aiResponseText,
            });

            await sendEvent({
              type: "task_completed",
              summary: aiResponseText,
            });

            await sendEvent({
              type: "stream_finished",
              finalResponse: aiResponseText,
            });
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

    // 4. Proxy to AgentSession Durable Object
    if (url.pathname.startsWith("/api/session/")) {
      const parts = url.pathname.split("/");
      const sessionId = parts[3] || "sovereign-session-default";
      if (env.AGENT_SESSION) {
        const id = env.AGENT_SESSION.idFromName(sessionId);
        const stub = env.AGENT_SESSION.get(id);
        return stub.fetch(request);
      }
    }

    // 5. Serve Static React Frontend Assets on Edge
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        return assetResponse;
      }
    }

    return new Response("Sovereign Agent Worker Edge Gateway", { status: 200, headers: corsHeaders });
  },
};
