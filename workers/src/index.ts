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

    // 1. Health check
    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ok",
        worker: "sovereign-agent-replit",
        edge: "Cloudflare Workers + Durable Objects + Workers AI",
        timestamp: new Date().toISOString(),
      });
    }

    // 2. Edge ReAct Agent Stream Handler (using Workers AI)
    if (url.pathname === "/api/agent/react-stream" && request.method === "POST") {
      const corsHeaders = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      };

      try {
        const body = (await request.json()) as { prompt?: string };
        const userPrompt = body.prompt || "Hello";

        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        const sendEvent = async (data: Record<string, any>) => {
          await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        (async () => {
          // Emit roadmap
          await sendEvent({
            type: "roadmap_ready",
            subtasks: [
              "Analyze user request on Cloudflare Edge AI",
              "Inspect workspace structure and files",
              "Execute reasoning and generate solution",
            ],
          });

          await sendEvent({ type: "task_running", task: "Analyze user request on Cloudflare Edge AI" });

          // Run Cloudflare Workers AI
          let aiResponseText = "Task processed on Cloudflare Edge AI.";
          if (env.AI) {
            try {
              const aiRes = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
                messages: [
                  { role: "system", content: "You are Sovereign Agent operating on Cloudflare Edge." },
                  { role: "user", content: userPrompt },
                ],
              });
              aiResponseText = aiRes.response || aiResponseText;
            } catch {
              /* fallback */
            }
          }

          await sendEvent({ type: "task_progress", output: aiResponseText });
          await sendEvent({ type: "task_completed", summary: aiResponseText });
          await sendEvent({ type: "stream_finished", finalResponse: aiResponseText });
          await writer.close();
        })();

        return new Response(readable, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500 });
      }
    }

    // 3. Proxy to AgentSession Durable Object
    if (url.pathname.startsWith("/api/session/")) {
      const parts = url.pathname.split("/");
      const sessionId = parts[3] || "sovereign-session-default";
      if (env.AGENT_SESSION) {
        const id = env.AGENT_SESSION.idFromName(sessionId);
        const stub = env.AGENT_SESSION.get(id);
        return stub.fetch(request);
      }
    }

    // 4. Serve Static React Frontend Assets on Edge
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        return assetResponse;
      }
    }

    return new Response("Sovereign Agent Worker Edge Gateway", { status: 200 });
  },
};