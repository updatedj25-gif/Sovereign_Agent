import { DurableObject } from "cloudflare:workers";

export interface ReActMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: any[];
}

export interface ReActTurnState {
  turn: number;
  thought?: string;
  tool?: string;
  params?: any;
  status: "running" | "waiting_approval" | "completed" | "failed" | "rejected";
  output?: string;
  dangerReason?: string;
  approvalId?: string;
}

export interface PendingApprovalData {
  approvalId: string;
  toolName: string;
  params: any;
  dangerReason?: string;
}

/**
 * AgentSession Durable Object
 * Edge state persistent coordinator handling session memory, multi-turn tool history, and pending HITL approvals across disconnects.
 */
export class AgentSession extends DurableObject {
  private messages: ReActMessage[] = [];
  private reactTurns: ReActTurnState[] = [];
  private pendingApproval: PendingApprovalData | null = null;

  constructor(ctx: DurableObjectState, env: Record<string, any>) {
    super(ctx, env);

    // Hydrate state from persistent storage
    this.ctx.blockConcurrencyWhile(async () => {
      const storedMsgs = await this.ctx.storage.get<ReActMessage[]>("messages");
      const storedTurns = await this.ctx.storage.get<ReActTurnState[]>("reactTurns");
      const storedApproval = await this.ctx.storage.get<PendingApprovalData | null>("pendingApproval");

      if (storedMsgs) this.messages = storedMsgs;
      if (storedTurns) this.reactTurns = storedTurns;
      if (storedApproval) this.pendingApproval = storedApproval;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 1. GET /api/session/:id/history — Return full conversation & turn history
    if (url.pathname.endsWith("/history") && request.method === "GET") {
      return Response.json({
        messages: this.messages,
        reactTurns: this.reactTurns,
        pendingApproval: this.pendingApproval,
      });
    }

    // 2. POST /api/session/:id/message — Append turn message to DO storage
    if (url.pathname.endsWith("/message") && request.method === "POST") {
      const body = (await request.json()) as ReActMessage;
      this.messages.push(body);

      // Keep context bounded (max 40 turns)
      if (this.messages.length > 40) {
        this.messages = [this.messages[0], ...this.messages.slice(-39)];
      }

      await this.ctx.storage.put("messages", this.messages);
      return Response.json({ success: true, count: this.messages.length });
    }

    // 3. POST /api/session/:id/approval — Store or clear pending HITL state
    if (url.pathname.endsWith("/approval") && request.method === "POST") {
      const body = (await request.json()) as { approval: PendingApprovalData | null };
      this.pendingApproval = body.approval;
      await this.ctx.storage.put("pendingApproval", this.pendingApproval);
      return Response.json({ success: true, pendingApproval: this.pendingApproval });
    }

    // 4. GET /stream — SSE Edge Stream Handler
    if (url.pathname.endsWith("/stream")) {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      const sendEvent = async (data: Record<string, any>) => {
        await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      (async () => {
        if (this.pendingApproval) {
          await sendEvent({
            type: "hitl_approval_required",
            ...this.pendingApproval,
          });
        }

        await sendEvent({ type: "stream_finished", response: "Session synchronized." });
        await writer.close();
      })();

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  }
}

/**
 * Legacy Durable Object Class Stub required by Cloudflare API during migrations
 */
export class BrowserRun extends DurableObject {
  async fetch(_request: Request): Promise<Response> {
    return new Response("BrowserRun class stub active", { status: 200 });
  }
}

export default {
  async fetch(request: Request, env: Record<string, any>): Promise<Response> {
    const url = new URL(request.url);

    // 1. Health check endpoint
    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ok",
        worker: "sovereign-agent-replit",
        edge: "Cloudflare Workers + Durable Objects + Static Assets",
        timestamp: new Date().toISOString(),
      });
    }

    // 2. Proxy requests to AgentSession Durable Object
    if (url.pathname.startsWith("/api/session/")) {
      const parts = url.pathname.split("/");
      const sessionId = parts[3] || "sovereign-session-default";

      if (env.AGENT_SESSION) {
        const id = env.AGENT_SESSION.idFromName(sessionId);
        const stub = env.AGENT_SESSION.get(id);
        return stub.fetch(request);
      }
    }

    // 3. Serve React Frontend Static Assets on Cloudflare Edge
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        return assetResponse;
      }
    }

    return new Response("Sovereign Agent Worker Edge Gateway", { status: 200 });
  },
};