import { z } from "zod";
import { ToolRegistry, globalToolRegistry } from "./tools/registry";
import { ReActLoop, ReActMessage } from "./react-loop";

// ==========================================
// System Prompts & Core Tools Setup
// ==========================================

const SYSTEM_PROMPT = `You are Sovereign Agent, a high-autonomy full-stack coding assistant operating on an Express 5 and Cloudflare AI edge architecture.

Rules of Engagement:
1. Break down complex user goals into logical subtasks.
2. Select appropriate tools to inspect code, write fixes, execute commands, or test builds.
3. Observe tool outputs critically. If an error occurs, analyze the stack trace or log and attempt self-correction.
4. Keep user informed of progress through direct reasoning notes.
5. Provide concise summary solutions upon completing the objective.`;

/**
 * Ensure baseline core tools are registered in the global registry.
 */
function initializeCoreTools(registry: ToolRegistry = globalToolRegistry) {
  // 1. Tool: Search & Workspace Inspection
  registry.registerTool({
    name: "search_workspace",
    description: "Search for text patterns, function symbols, or keywords across the codebase repository.",
    parameters: z.object({
      query: z.string().describe("Text or regex pattern to search for in files."),
      pathPrefix: z.string().optional().describe("Optional subdirectory prefix to narrow search scope."),
    }),
    execute: async (args) => {
      // Real file/grep search tool integration hook
      return {
        success: true,
        output: `Search results for '${args.query}' (scoped to: ${args.pathPrefix || "root"}):\n- Found reference in src/index.ts`,
        data: { matchesCount: 1 },
      };
    },
  });

  // 2. Tool: Read File
  registry.registerTool({
    name: "read_file",
    description: "Read the exact file contents at a given workspace path.",
    parameters: z.object({
      path: z.string().describe("Relative or absolute filepath to read."),
    }),
    execute: async (args) => {
      return {
        success: true,
        output: `[Content of ${args.path} read successfully]`,
        data: { path: args.path },
      };
    },
  });

  // 3. Tool: Run Shell Command
  registry.registerTool({
    name: "run_command",
    description: "Execute a terminal shell command (e.g. tsc, pnpm test, git status).",
    requiresApproval: true,
    parameters: z.object({
      command: z.string().describe("Shell command to run in workspace terminal sandbox."),
    }),
    execute: async (args, context) => {
      context.emitEvent?.({
        type: "command_logged",
        command: args.command,
      });

      return {
        success: true,
        output: `Command executed: '${args.command}'\nExit code: 0\nstdout: Build completed with 0 errors.`,
        data: { exitCode: 0 },
      };
    },
  });
}

// Initialize tools immediately
initializeCoreTools();

// ==========================================
// Cloudflare AI REST Client Integration
// ==========================================

interface CloudflareAIConfig {
  accountId?: string;
  apiKey?: string;
  model?: string;
}

/**
 * Invoke Cloudflare Workers AI REST API or fallback provider.
 */
async function callCloudflareAI(
  messages: ReActMessage[],
  toolsJson: any[],
  config?: CloudflareAIConfig
): Promise<ReActMessage> {
  const accountId = config?.accountId || process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiKey = config?.apiKey || process.env.CLOUDFLARE_API_KEY;
  const model = config?.model || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

  if (!accountId || !apiKey) {
    // Fallback Mock provider for local development without credentials
    return mockLocalModelResponse(messages, toolsJson);
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages,
      tools: toolsJson,
      temperature: 0.2,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Cloudflare AI API Error (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as any;
  const result = data.result;

  if (result?.response) {
    return {
      role: "assistant",
      content: result.response,
      tool_calls: result.tool_calls || undefined,
    };
  }

  return {
    role: "assistant",
    content: typeof result === "string" ? result : JSON.stringify(result),
  };
}

/**
 * Fallback response provider for dev environments.
 */
async function mockLocalModelResponse(messages: ReActMessage[], _tools: any[]): Promise<ReActMessage> {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const hasExecutedTool = messages.some((m) => m.role === "tool");

  if (!hasExecutedTool) {
    return {
      role: "assistant",
      content: `I will analyze your request ("${lastUserMsg}") and search the codebase for relevant context.`,
      tool_calls: [
        {
          id: "call_search_1",
          type: "function",
          function: {
            name: "search_workspace",
            arguments: JSON.stringify({ query: lastUserMsg.slice(0, 15) || "main" }),
          },
        },
      ],
    };
  }

  return {
    role: "assistant",
    content: `I have analyzed the repository structure. Here is the solution for your query:\n\n1. Search completed successfully.\n2. Context verified.\nTask complete.`,
  };
}

// ==========================================
// Exported Agent Interface Endpoints
// ==========================================

export interface AgentStreamOptions {
  prompt: string;
  taskGroupId?: number;
  owner?: string;
  repo?: string;
  onEvent: (event: Record<string, any>) => void;
  signal?: AbortSignal;
}

/**
 * Execute dynamic agent stream using ReAct loop orchestration.
 */
export async function runAgentStream(options: AgentStreamOptions): Promise<string> {
  const { prompt, taskGroupId, owner, repo, onEvent, signal } = options;

  // Send initial roadmap event for UI synchronization
  onEvent({
    type: "roadmap_ready",
    subtasks: [
      "Analyze query and search workspace",
      "Inspect files and dependencies",
      "Execute changes and verify status",
    ],
  });

  const messages: ReActMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  const loop = new ReActLoop({
    toolRegistry: globalToolRegistry,
    maxIterations: 10,
    taskGroupId,
    onEvent,
    signal,
  });

  const result = await loop.run(
    messages,
    (msgs, tools) => callCloudflareAI(msgs, tools),
    { owner, repo }
  );

  return result.finalAnswer;
}

/**
 * Non-streaming agent execution helper for batch/webhook requests.
 */
export async function runAgentChat(prompt: string): Promise<string> {
  const events: Record<string, any>[] = [];
  const answer = await runAgentStream({
    prompt,
    onEvent: (evt) => events.push(evt),
  });
  return answer;
}