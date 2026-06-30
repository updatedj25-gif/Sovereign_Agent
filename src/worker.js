import { AgentSession } from './agent.js';
import { FileToolsMcp, GitToolsMcp, ProjectTools, RateLimiter, Sandbox, SelfHealMcp } from './mcp.js';

// CORS Headers Helper
function getCorsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  
  // Explicitly check for local environments or your dedicated UI worker deployment address
  const allowed = 
    origin.includes('localhost') || 
    origin.includes('sovereign-agent') || 
    origin.includes('pages.dev') ||
    origin === 'https://sovereign-agent-ui.trinityceo717.workers.dev';

  return {
    'Access-Control-Allow-Origin': allowed ? origin : '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Session-Id',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const cors = getCorsHeaders(request, env);

    // Handle Pre-flight options request from browser
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // ── /api/health ──────────────────────────────────────────
    if (path === '/api/health' && method === 'GET') {
      return jsonResponse({
        status: 'ok',
        service: 'sovereign-agent-core',
        timestamp: new Date().toISOString(),
        version: env.WORKER_VERSION || '2.0.0',
        durableObjects: {
          agentSession: !!env.AGENT_SESSION,
          fileToolsMcp: !!env.FILE_TOOLS_MCP,
          gitToolsMcp: !!env.GIT_TOOLS_MCP,
          projectTools: !!env.PROJECT_TOOLS,
          rateLimiter: !!env.RATE_LIMITER,
          sandbox: !!env.Sandbox,
          selfHealMcp: !!env.SELF_HEAL_MCP,
        }
      }, 200, cors);
    }

    // ── /api/models ──────────────────────────────────────────
    if (path === '/api/models' && method === 'GET') {
      return jsonResponse({
        provider: 'Cloudflare Workers AI',
        models: [
          { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', role: 'primary-chat', context: 128000 },
          { id: '@cf/meta/llama-3.1-8b-instruct', role: 'fallback', context: 128000 },
          { id: '@cf/baai/bge-small-en-v1.5', role: 'embeddings', dims: 384 },
        ],
      }, 200, cors);
    }

    // Determine Session ID from custom header or search params
    const sessionId = request.headers.get('X-Session-Id') || url.searchParams.get('sessionId') || 'default_session';

    // ── /api/agent/chat & /api/agent/stream ──────────────────
    if ((path === '/api/agent/chat' || path === '/api/agent/stream') && method === 'POST') {
      const doId = env.AGENT_SESSION.idFromName(sessionId);
      const stub = env.AGENT_SESSION.get(doId);
      
      // Safeguard execution by cloning the incoming payload stream
      const requestBody = await request.clone().text();

      // Forward the request directly to the AgentSession Durable Object
      const response = await stub.fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: requestBody,
      });

      // Inject robust CORS safety protocols back onto the response object
      const newHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(cors)) {
        newHeaders.set(key, value);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }

    // ── /api/agent/files/* ────────────────────────────────────
    // Automatically routes /api/agent/files, /view, /write, /delete, /tree, and /create-folder
    if (path.startsWith('/api/agent/files')) {
      const doId = env.FILE_TOOLS_MCP.idFromName(sessionId);
      const stub = env.FILE_TOOLS_MCP.get(doId);

      const hasBody = method !== 'GET' && method !== 'HEAD';
      const requestBody = hasBody ? await request.clone().text() : null;

      // Forward request to FileToolsMcp Durable Object
      const response = await stub.fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: requestBody,
      });

      const newHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(cors)) {
        newHeaders.set(key, value);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }

    // ── /api/agent/steps ──────────────────────────────────────
    if (path === '/api/agent/steps' && method === 'GET') {
      const doId = env.AGENT_SESSION.idFromName(sessionId);
      const stub = env.AGENT_SESSION.get(doId);
      const response = await stub.fetch(request.url);
      
      const newHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(cors)) {
        newHeaders.set(key, value);
      }

      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });
    }

    // Fallthrough: Server default message when endpoints do not resolve
    return new Response('Not Found', { status: 404, headers: cors });
  }
};

export { AgentSession, FileToolsMcp, GitToolsMcp, ProjectTools, RateLimiter, Sandbox, SelfHealMcp };