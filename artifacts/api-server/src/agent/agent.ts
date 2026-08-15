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

Capabilities & Rules:
1. Break down user goals into clear steps.
2. You have a full suite of tools: create_directory, write_file, read_file, delete_file, list_directory, search_workspace, apply_patch, and run_command.
3. When asked to create folders or directories (e.g. 'create a folder'), call the create_directory tool or run_command.
4. When asked to create or edit files, use write_file or apply_patch.
5. If an error occurs, analyze the error output and attempt self-correction.
6. Provide concise, helpful summaries when the task is complete.`;

/**
 * Register real, non-stub core workspace tools in the tool registry.
 */
function initializeCoreTools(registry: ToolRegistry = globalToolRegistry) {
  // 1. Tool: Create Directory
  registry.registerTool({
    name: "create_directory",
    description: "Creates a new folder or directory (and any necessary parent directories) in the workspace.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative directory path to create (e.g. 'src/components/common' or 'my-new-folder')",
        },
      },
      required: ["path"],
    },
    execute: async (args: any) => {
      try {
        const targetDir = resolveWorkspacePath(args.path || args.dirPath || "new-folder");
        await fs.mkdir(targetDir, { recursive: true });
        return {
          success: true,
          output: `Successfully created directory '${args.path || args.dirPath}'.`,
          data: { path: args.path },
        };
      } catch (err: any) {
        return {
          success: false,
          output: `Failed to create directory '${args.path}': ${err.message}`,
        };
      }
    },
  });

  // 2. Tool: Search & Workspace Inspection
  registry.registerTool({
    name: "search_workspace",
    description: "Search for text patterns, function symbols, or keywords across workspace files.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text or regex pattern to search for in files." },
        pathPrefix: { type: "string", description: "Optional subdirectory prefix to narrow search scope." },
      },
      required: ["query"],
    },
    execute: async (args: any) => {
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

  // 3. Tool: Read File
  registry.registerTool({
    name: "read_file",
    description: "Read the exact text contents of a file at a given workspace path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative filepath to read from workspace root." },
      },
      required: ["path"],
    },
    execute: async (args: any) => {
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

  // 4. Tool: Write File
  registry.registerTool({
    name: "write_file",
    description: "Create or overwrite a file with specified content.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative filepath to write." },
        content: { type: "string", description: "Full file content to write." },
      },
      required: ["path", "content"],
    },
    execute: async (args: any) => {
      try {
        const targetPath = resolveWorkspacePath(args.path);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, args.content || "", "utf-8");
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

  // 5. Tool: Delete File or Directory
  registry.registerTool({
    name: "delete_file",
    description: "Deletes a file or directory at the given path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file or directory path to remove." },
      },
      required: ["path"],
    },
    execute: async (args: any) => {
      try {
        const targetPath = resolveWorkspacePath(args.path);
        await fs.rm(targetPath, { recursive: true, force: true });
        return {
          success: true,
          output: `Successfully deleted '${args.path}'.`,
          data: { path: args.path },
        };
      } catch (err: any) {
        return {
          success: false,
          output: `Failed to delete '${args.path}': ${err.message}`,
        };
      }
    },
  });

  // 6. Tool: Apply Exact Patch
  registry.registerTool({
    name: "apply_patch",
    description: "Replace an exact target segment of code in a file with new code.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative filepath to patch." },
        oldStr: { type: "string", description: "Exact string segment to search for and replace." },
        newStr: { type: "string", description: "New replacement string segment." },
      },
      required: ["path", "oldStr", "newStr"],
    },
    execute: async (args: any) => {
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

  // 7. Tool: List Directory
  registry.registerTool({
    name: "list_directory",
    description: "List directory files and folder contents.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path relative to workspace (defaults to '.')." },
      },
    },
    execute: async (args: any) => {
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

  // 8. Tool: Run Shell Command
  registry.registerTool({
    name: "run_command",
    description: "Execute a shell command (e.g., mkdir, pnpm run typecheck, npm test, git status) in terminal sandbox.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command string to run in workspace directory." },
      },
      required: ["command"],
    },
    execute: async (args: any, context?: any) => {
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