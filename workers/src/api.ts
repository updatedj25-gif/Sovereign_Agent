import { DurableObject } from "cloudflare:workers";

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
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // GET /api/health — Edge API Gateway Health Check
    if (url.pathname === "/api/health") {
      return Response.json(
        {
          status: "ok",
          service: "sovereign-agent-api-replit",
          environment: env.ENVIRONMENT || "production",
          timestamp: new Date().toISOString(),
        },
        { headers: corsHeaders }
      );
    }

    // POST /api/agent/chat — Non-streaming chat endpoint
    if (url.pathname === "/api/agent/chat" && request.method === "POST") {
      try {
        const body = (await request.json()) as { prompt?: string };
        const prompt = body.prompt || "Hello";

        return Response.json(
          {
            success: true,
            response: `Edge API received request: "${prompt}"`,
          },
          { headers: corsHeaders }
        );
      } catch (err: any) {
        return Response.json(
          { error: "Invalid JSON request", message: err.message },
          { status: 400, headers: corsHeaders }
        );
      }
    }

    return Response.json(
      {
        status: "ok",
        service: "sovereign-agent-api-replit",
        message: "Sovereign Agent Edge API Gateway active",
      },
      { headers: corsHeaders }
    );
  },
};