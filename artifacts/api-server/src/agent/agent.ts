import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import { ToolRegistry, globalToolRegistry } from "./tools/registry";
import { ReActLoop, ReActMessage } from "./react-loop";

const execAsync = promisify(exec);

// ==========================================
// Workspace Path Security & Helper Utilities
// ==========================================

const WORKSPACE_ROOT = path.resolve(process.cwd());

function resolveWorkspacePath(relativePath: string): string {
  const resolved = path.resolve(WORKSPACE_ROOT, relativePath);
  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    throw new Error(`Security Violation: Path '${relativePath}' attempts to traverse outside workspace root.`);
  }
  return resolved;
}

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
 * Register real, non-stub core workspace tools in the tool registry.
 */
function initializeCoreTools(registry: ToolRegistry = globalToolRegistry) {
  // 1. Tool: Search & Workspace Inspection (Real Filesystem Regex Search)
  registry.registerTool({
    name: "search_workspace",
    description: "Search for text patterns, function symbols, or keywords across workspace files.",
    parameters: z.object({
      query: z.string().describe("Text or regex pattern to search for in files."),
      pathPrefix: z.string().optional().describe("Optional subdirectory prefix to narrow search scope."),
    }),
    execute: async (args) => {
      try {
        const searchDir = resolveWorkspacePath(args.pathPrefix || ".");
        const regex = new RegExp(args.query, "i");
        const matches: string[] = [];

        async function scanDir(dir: string) {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
              continue;
            }
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await scanDir(fullPath);
            } else if (entry.isFile()) {
              try {
                const content = await fs.readFile(fullPath, "utf-8");
                if (regex.test(content)) {
                  const relPath = path.relative(WORKSPACE_ROOT, fullPath);
                  matches.push(relPath);
                }
              } catch {
                /* skip binary/unreadable files */
              }
            }
          }
        }

        await scanDir(searchDir);

        return {
          success: true,
          output: matches.length > 0
            ? `Found '${args.query}' in ${matches.length} file(s):\n${matches.slice(0, 20).map((m) => `- ${m}`).join("\n")}`
            : `No occurrences of '${args.query}' found in ${args.pathPrefix || "workspace root"}.`,
          data: { matchesCount: matches.length, matches },
        };
      } catch (err: any) {
        return {
          success: false,
          output: `Search failed: ${err.message}`,
        };
      }
    },
  });

  // 2. Tool: Read File (Real Filesystem Read)
  registry.registerTool({
    name: "read_file",
    description: "Read the exact text contents of a file at a given workspace path.",
    parameters: z.object({
      path: z.string().describe("Relative filepath to read from workspace root."),
    }),
    execute: async (args) => {
      try {
        const targetPath = resolveWorkspacePath(args.path);
        const content = await fs.readFile(targetPath, "utf-8");
        return {
          success: true,
          output: content,
          data: { path: args.path, sizeBytes: Buffer.byteLength(content) },
        };
      } catch (err: any) {
        return {
          success: false,
          output: `Failed to read file '${args.path}': ${err.message}`,
        };
      }
    },
  });

  // 3. Tool: Write File (Real Filesystem Create/Overwrite)
  registry.registerTool({
    name: "write_file",
    description: "Create or overwrite a file with specified content.",
    parameters: z.object({
      path: z.string().describe("Relative filepath to write."),
      content: z.string().describe("Full file content to write."),
    }),
    execute: async (args) => {
      try {
        const targetPath = resolveWorkspacePath(args.path);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, args.content, "utf-8");
        return {
          success: true,
          output: `File successfully written to '${args.path}'`,
          data: { path: args.path },
        };
      } catch (err: any) {
        return {
          success: false,
          output: `Failed to write file '${args.path}': ${err.message}`,
        };
      }
    },
  });

  // 4. Tool: Apply Exact Patch (Replace Code Block)
  registry.registerTool({
    name: "apply_patch",
    description: "Replace an exact target segment of code in a file with new code.",
    parameters: z.object({
      path: z.string().describe("Relative filepath to patch."),
      oldStr: z.string().describe("Exact string segment to search for and replace."),
      newStr: z.string().describe("New replacement string segment."),
    }),
    execute: async (args) => {
      try {
        const targetPath = resolveWorkspacePath(args.path);
        const content = await fs.readFile(targetPath, "utf-8");
        if (!content.includes(args.oldStr)) {
          return {
            success: false,
            output: `Patch error: Could not find exact search segment inside '${args.path}'.`,
          };
        }
        const updatedContent = content.replace(args.oldStr, args.newStr);
        await fs.writeFile(targetPath, updatedContent, "utf-8");
        return {
          success: true,
          output: `Successfully applied patch to '${args.path}'.`,
        };
      } catch (err: any) {
        return {
          success: false,
          output: `Patch failed on '${args.path}': ${err.message}`,
        };
      }
    },
  });

  // 5. Tool: List Directory
  registry.registerTool({
    name: "list_directory",
    description: "List directory files and folder contents.",
    parameters: z.object({
      path: z.string().optional().describe("Directory path relative to workspace (defaults to '.')."),
    }),
    execute: async (args) => {
      try {
        const targetDir = resolveWorkspacePath(args.path || ".");
        const entries = await fs.readdir(targetDir, { withFileTypes: true });
        const listing = entries
          .map((e) => `${e.isDirectory() ? "[DIR]" : "[FILE]"} ${e.name}`)
          .join("\n");
        return {
          success: true,
          output: listing || "(empty directory)",
        };
      } catch (err: any) {
        return {
          success: false,
          output: `Failed to list directory: ${err.message}`,
        };
      }
    },
  });

  // 6. Tool: Run Shell Command (Real Terminal Sandbox Execution)
  registry.registerTool({
    name: "run_command",
    description: "Execute a shell command (e.g., pnpm run typecheck, npm test, git status) in terminal sandbox.",
    requiresApproval: false,
    parameters: z.object({
      command: z.string().describe("Shell command string to run in workspace directory."),
    }),
    execute: async (args, context) => {
      // Basic dangerous command filter
      if (/rm\s+-rf\s+\/|mkfs|dd|:\(\)\{\s*:\|:&\s*\};:/i.test(args.command)) {
        return {
          success: false,
          output: "Command blocked by agent security policy.",
        };
      }

      context?.emitEvent?.({
        type: "command_logged",
        command: args.command,
      });

      try {
        const { stdout, stderr } = await execAsync(args.command, {
          cwd: WORKSPACE_ROOT,
          timeout: 60000,
        });

        return {
          success: true,
          output: stdout || stderr || "Command completed with no output.",
          data: { stdout, stderr, exitCode: 0 },
        };
      } catch (err: any) {
        return {
          success: false,
          output: `Command failed (exit code ${err.code || 1}):\n${err.stdout || ""}\n${err.stderr || err.message}`,
          data: { exitCode: err.code || 1, stderr: err.stderr },
        };
      }
    },
  });
}

// Initialize workspace tools
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
    // Fallback model response for local dev without secrets
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
 * Fallback response provider for offline local dev environments.
 */
async function mockLocalModelResponse(messages: ReActMessage[], _tools: any[]): Promise<ReActMessage> {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const hasExecutedTool = messages.some((m) => m.role === "tool");

  if (!hasExecutedTool) {
    return {
      role: "assistant",
      content: `I will analyze your request ("${lastUserMsg}") and inspect the workspace for relevant context.`,
      tool_calls: [
        {
          id: "call_search_1",
          type: "function",
          function: {
            name: "search_workspace",
            arguments: JSON.stringify({ query: lastUserMsg.slice(0, 15) || "src" }),
          },
        },
      ],
    };
  }

  return {
    role: "assistant",
    content: `I have inspected the repository structure and executed necessary actions.\n\nTask complete.`,
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

  // Emits initial UI roadmap event matching frontend contract (subtasks must be string[])
  onEvent({
    type: "roadmap_ready",
    subtasks: [
      "Analyze prompt and inspect workspace context",
      "Execute code search and read target files",
      "Apply code modifications and run verification build",
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

  onEvent({ type: "stream_finished", finalResponse: result.finalAnswer });
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