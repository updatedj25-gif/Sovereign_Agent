import * as path from "node:path";
import * as fs from "node:fs/promises";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { z, ZodSchema } from "zod";
import { SandboxExecutor } from "../services/sandbox";
import { DiffEngine } from "../services/diff-patch";

const exec = promisify(execCb);

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface AgentContext {
  taskGroupId: string;
  workspaceRoot: string;
  userId?: string;
  [key: string]: any;
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema: ZodSchema;
  execute(args: Record<string, any>, context: AgentContext): Promise<ToolResult>;
}

export const ReadFileSchema = z.object({
  path: z.string().min(1),
  encoding: z.string().optional(),
});

export const WriteFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const EditFileDiffSchema = z.object({
  path: z.string().min(1),
  search_block: z.string().min(1),
  replace_block: z.string().min(1),
});

export const ListDirectorySchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().optional(),
});

export const ExecuteTerminalCmdSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeout_ms: z.number().int().positive().optional(),
});

export const GrepSearchSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
  include_pattern: z.string().optional(),
});

export const GitCommitSchema = z.object({
  message: z.string().min(1),
  stage_all: z.boolean().optional(),
});

function resolveSafePath(workspaceRoot: string, relativePath: string): string {
  const normalized = path.normalize(relativePath);
  const candidate = path.isAbsolute(normalized)
    ? normalized
    : path.join(workspaceRoot, normalized);

  const resolved = path.resolve(candidate);
  const resolvedRoot = path.resolve(workspaceRoot);

  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    throw new Error(`Path resolution outside workspace root is not allowed: ${relativePath}`);
  }

  return resolved;
}

async function safeReadFile(fullPath: string, encoding: BufferEncoding = "utf-8"): Promise<string> {
  return fs.readFile(fullPath, { encoding });
}

async function safeWriteFile(fullPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

async function safeListDirectory(fullPath: string, recursive = false): Promise<string> {
  const stats = await fs.stat(fullPath);
  if (!stats.isDirectory()) {
    throw new Error(`Provided path is not a directory: ${fullPath}`);
  }

  async function walk(dir: string, prefix = ""): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const results: string[] = [];
    for (const entry of entries) {
      const relative = path.join(prefix, entry.name);
      results.push(relative + (entry.isDirectory() ? path.sep : ""));
      if (recursive && entry.isDirectory()) {
        const deeper = await walk(path.join(dir, entry.name), relative);
        results.push(...deeper);
      }
    }
    return results;
  }

  const listing = await walk(fullPath);
  return listing.join("\n");
}

async function safeExecuteCommand(
  command: string,
  cwd: string,
  timeoutMs: number = 120000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const sanitizedCwd = path.resolve(cwd);
  return exec(command, { cwd: sanitizedCwd, timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 })
    .then((result) => ({ stdout: result.stdout, stderr: result.stderr, exitCode: 0 }))
    .catch((error: any) => {
      if (error.killed || error.signal) {
        return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", exitCode: error.code ?? 1 };
      }
      return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", exitCode: error.code ?? 1 };
    });
}

function jsonSchemaFromZod(schema: ZodSchema): Record<string, any> {
  if (typeof (schema as any).toJSON === "function") {
    return (schema as any).toJSON();
  }
  return { type: "object", properties: {} };
}

export const tools: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read a file from the workspace.",
    schema: ReadFileSchema,
    execute: async (args, context) => {
      const parsed = ReadFileSchema.safeParse(args);
      if (!parsed.success) {
        return { success: false, output: "", error: parsed.error.message };
      }
      const { path: targetPath, encoding } = parsed.data;
      try {
        const executor = new SandboxExecutor(context.workspaceRoot);
        const encodingOption = (encoding ?? "utf-8") as BufferEncoding;
        const content = await executor.readFile(targetPath, encodingOption);
        return { success: true, output: content };
      } catch (error: any) {
        return { success: false, output: "", error: error.message }; 
      }
    },
  },
  {
    name: "write_file",
    description: "Write text content to a file in the workspace.",
    schema: WriteFileSchema,
    execute: async (args, context) => {
      const parsed = WriteFileSchema.safeParse(args);
      if (!parsed.success) {
        return { success: false, output: "", error: parsed.error.message };
      }
      const { path: targetPath, content } = parsed.data;
      try {
        const executor = new SandboxExecutor(context.workspaceRoot);
        const msg = await executor.writeFile(targetPath, content);
        return { success: true, output: msg };
      } catch (error: any) {
        return { success: false, output: "", error: error.message };
      }
    },
  },
  {
    name: "edit_file_diff",
    description: "Edit a file by replacing a search block with a replacement block.",
    schema: EditFileDiffSchema,
    execute: async (args, context) => {
      const parsed = EditFileDiffSchema.safeParse(args);
      if (!parsed.success) {
        return { success: false, output: "", error: parsed.error.message };
      }
      const { path: targetPath, search_block, replace_block } = parsed.data;
      try {
        const diffEngine = new DiffEngine(context.workspaceRoot);
        const res = await diffEngine.applyDiff(
          targetPath,
          replace_block,
          "search-replace",
          context.workspaceRoot,
          search_block,
          replace_block
        );
        return {
          success: res.success,
          output: res.output,
          error: res.error,
          metadata: res.diff ? { diff: res.diff } : undefined,
        };
      } catch (error: any) {
        return { success: false, output: "", error: error.message };
      }
    },
  },
  {
    name: "list_directory",
    description: "List files and directories under a workspace path.",
    schema: ListDirectorySchema,
    execute: async (args, context) => {
      const parsed = ListDirectorySchema.safeParse(args);
      if (!parsed.success) {
        return { success: false, output: "", error: parsed.error.message };
      }
      const { path: targetPath, recursive } = parsed.data;
      try {
        const executor = new SandboxExecutor(context.workspaceRoot);
        const listing = await executor.listDirectory(targetPath, recursive ?? false);
        return { success: true, output: listing };
      } catch (error: any) {
        return { success: false, output: "", error: error.message };
      }
    },
  },
  {
    name: "execute_terminal_cmd",
    description: "Execute a shell command in the workspace.",
    schema: ExecuteTerminalCmdSchema,
    execute: async (args, context) => {
      const parsed = ExecuteTerminalCmdSchema.safeParse(args);
      if (!parsed.success) {
        return { success: false, output: "", error: parsed.error.message };
      }
      const { command, cwd, timeout_ms } = parsed.data;
      try {
        const executor = new SandboxExecutor(context.workspaceRoot);
        const result = await executor.executeCommand(command, { cwd, timeoutMs: timeout_ms });
        const output = [result.stdout, result.stderr].filter(Boolean).join("\n") || "";
        return {
          success: result.exitCode === 0,
          output: output || `Command completed with exit code ${result.exitCode}`,
          error: result.exitCode === 0 ? undefined : `Command exited with code ${result.exitCode}`,
          metadata: { exitCode: result.exitCode },
        };
      } catch (error: any) {
        return { success: false, output: "", error: error.message };
      }
    },
  },
  {
    name: "grep_search",
    description: "Search for a pattern in workspace files.",
    schema: GrepSearchSchema,
    execute: async (args, context) => {
      const parsed = GrepSearchSchema.safeParse(args);
      if (!parsed.success) {
        return { success: false, output: "", error: parsed.error.message };
      }
      const { pattern, path: targetPath, include_pattern } = parsed.data;
      try {
        const executor = new SandboxExecutor(context.workspaceRoot);
        const result = await executor.grepSearch(pattern, targetPath || ".", include_pattern);
        return {
          success: result.success,
          output: result.output,
          error: result.error,
        };
      } catch (error: any) {
        return { success: false, output: "", error: error.message };
      }
    },
  },
  {
    name: "git_commit",
    description: "Create a git commit in the workspace.",
    schema: GitCommitSchema,
    execute: async (args, context) => {
      const parsed = GitCommitSchema.safeParse(args);
      if (!parsed.success) {
        return { success: false, output: "", error: parsed.error.message };
      }
      const { message, stage_all } = parsed.data;
      try {
        const executor = new SandboxExecutor(context.workspaceRoot);
        if (stage_all) {
          await executor.executeCommand("git add -A");
        }
        const result = await executor.executeCommand(`git commit -m '${message.replace(/'/g, "'\\''")}'`);
        const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
        return {
          success: result.exitCode === 0,
          output: output || `Git commit completed with exit code ${result.exitCode}`,
          error: result.exitCode === 0 ? undefined : `Git commit failed with exit code ${result.exitCode}`,
          metadata: { exitCode: result.exitCode },
        };
      } catch (error: any) {
        return { success: false, output: "", error: error.message };
      }
    },
  },
];

export function getToolDefinitions(): ToolDefinition[] {
  return tools;
}

export function getToolDefinitionsForLLM(): Array<{
  name: string;
  description: string;
  parameters: Record<string, any>;
}> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: jsonSchemaFromZod(tool.schema),
  }));
}

export async function executeTool(
  name: string,
  args: Record<string, any>,
  context: AgentContext
): Promise<ToolResult> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    return {
      success: false,
      output: "",
      error: `Tool '${name}' is not registered.`,
    };
  }

  try {
    return await tool.execute(args, context);
  } catch (error: any) {
    return {
      success: false,
      output: "",
      error: `Unhandled error in tool '${name}': ${error.message || String(error)}`,
    };
  }
}
