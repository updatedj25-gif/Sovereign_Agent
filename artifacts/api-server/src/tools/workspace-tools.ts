import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, any>;
    required: string[];
  };
}

export const WORKSPACE_TOOLS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read the exact text contents of a file relative to workspace root.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Relative file path (e.g., 'src/index.ts')" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file with specified content.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Relative file path to write" },
        content: { type: "string", description: "Full file text content" },
      },
      required: ["filePath", "content"],
    },
  },
  {
    name: "apply_patch",
    description: "Replace an exact target segment of code in a file with new code.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Relative file path" },
        oldStr: { type: "string", description: "Exact string segment to search for and replace" },
        newStr: { type: "string", description: "New replacement string segment" },
      },
      required: ["filePath", "oldStr", "newStr"],
    },
  },
  {
    name: "list_directory",
    description: "List directory files and subdirectories.",
    parameters: {
      type: "object",
      properties: {
        dirPath: { type: "string", description: "Relative directory path (defaults to '.')" },
      },
      required: [],
    },
  },
  {
    name: "search_code",
    description: "Search for text patterns or keywords across workspace files.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword or pattern to search for" },
        pathPrefix: { type: "string", description: "Optional subdirectory scope" },
      },
      required: ["query"],
    },
  },
  {
    name: "execute_command",
    description: "Execute a shell command (e.g., pnpm run typecheck, git status, npm test) in workspace terminal sandbox.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Terminal command line string" },
      },
      required: ["command"],
    },
  },
];

export class WorkspaceToolRunner {
  private workspaceRoot: string;

  constructor(workspaceRoot: string = process.cwd()) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  /**
   * Prevents directory traversal attacks by verifying path resolves within workspace root.
   */
  private resolvePath(relativePath: string): string {
    const resolved = path.resolve(this.workspaceRoot, relativePath || ".");
    if (!resolved.startsWith(this.workspaceRoot)) {
      throw new Error(`Security Violation: Path '${relativePath}' attempts to traverse outside workspace root.`);
    }
    return resolved;
  }

  /**
   * Dispatch tool execution call dynamically
   */
  async executeTool(
    name: string,
    args: Record<string, any>
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      switch (name) {
        case "read_file": {
          const target = this.resolvePath(args.filePath);
          const content = await fs.readFile(target, "utf-8");
          return { stdout: content, stderr: "", exitCode: 0 };
        }

        case "write_file": {
          const target = this.resolvePath(args.filePath);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, args.content, "utf-8");
          return { stdout: `Successfully wrote file: ${args.filePath}`, stderr: "", exitCode: 0 };
        }

        case "apply_patch": {
          const target = this.resolvePath(args.filePath);
          const content = await fs.readFile(target, "utf-8");
          if (!content.includes(args.oldStr)) {
            return {
              stdout: "",
              stderr: `Patch error: Could not find search segment in '${args.filePath}'`,
              exitCode: 1,
            };
          }
          const updated = content.replace(args.oldStr, args.newStr);
          await fs.writeFile(target, updated, "utf-8");
          return { stdout: `Successfully applied patch to '${args.filePath}'`, stderr: "", exitCode: 0 };
        }

        case "list_directory": {
          const target = this.resolvePath(args.dirPath || ".");
          const entries = await fs.readdir(target, { withFileTypes: true });
          const listing = entries
            .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "dist")
            .map((e) => `${e.isDirectory() ? "[DIR]" : "[FILE]"} ${e.name}`)
            .join("\n");
          return { stdout: listing || "(empty directory)", stderr: "", exitCode: 0 };
        }

        case "search_code": {
          const searchDir = this.resolvePath(args.pathPrefix || ".");
          const regex = new RegExp(args.query, "i");
          const matches: string[] = [];

          const scan = async (dir: string) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
                continue;
              }
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                await scan(fullPath);
              } else if (entry.isFile()) {
                try {
                  const txt = await fs.readFile(fullPath, "utf-8");
                  if (regex.test(txt)) {
                    matches.push(path.relative(this.workspaceRoot, fullPath));
                  }
                } catch {
                  /* Skip binary/unreadable files */
                }
              }
            }
          };

          await scan(searchDir);
          return {
            stdout:
              matches.length > 0
                ? `Matches for '${args.query}':\n${matches.slice(0, 30).map((m) => `- ${m}`).join("\n")}`
                : `No matches found for '${args.query}'.`,
            stderr: "",
            exitCode: 0,
          };
        }

        case "execute_command":
        case "run_command": {
          const cmd = args.command;
          // Filter malicious/destructive shell commands
          if (/rm\s+-rf\s+\/|mkfs|dd|:\(\)\{\s*:\|:&\s*\};:/i.test(cmd)) {
            return { stdout: "", stderr: "Command blocked by security policy.", exitCode: 127 };
          }
          const { stdout, stderr } = await execAsync(cmd, { cwd: this.workspaceRoot, timeout: 60000 });
          return { stdout, stderr, exitCode: 0 };
        }

        default:
          return { stdout: "", stderr: `Unknown tool name: ${name}`, exitCode: 1 };
      }
    } catch (err: any) {
      return {
        stdout: err.stdout || "",
        stderr: err.stderr || err.message || "Execution error",
        exitCode: typeof err.code === "number" ? err.code : 1,
      };
    }
  }
}