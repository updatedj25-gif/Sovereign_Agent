import { E2BSandboxManager } from "./e2b-sandbox";
import { FastCodeSearchService } from "./code-search";
import { EditVerificationService } from "./edit-verifier";
import { RepoMapService } from "./repo-map";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: "create_directory",
    description: "Creates a new folder / directory (and parent directories) in the workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative directory path to create (e.g. src/components/ui)" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Creates or overwrites a file with given text content.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Relative file path (e.g. src/index.ts)" },
        content: { type: "string", description: "Full text content to write." },
      },
      required: ["filePath", "content"],
    },
  },
  {
    name: "read_file",
    description: "Reads file content from the workspace sandbox.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Relative file path (e.g. src/index.ts)" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "delete_file",
    description: "Deletes a file or directory from the workspace.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Relative file or directory path to delete" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "list_directory",
    description: "Lists files and subdirectories in a directory.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path relative to workspace (defaults to '.')" },
      },
    },
  },
  {
    name: "exec_bash",
    description: "Executes shell commands inside the E2B Linux sandbox (e.g., pnpm test, npx tsc --noEmit, npm run build).",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to run." },
        cwd: { type: "string", description: "Working directory (default: /home/user/workspace)" },
      },
      required: ["command"],
    },
  },
  {
    name: "apply_diff",
    description: "Applies SEARCH/REPLACE diff blocks to edit files and automatically runs typecheck verification.",
    parameters: {
      type: "object",
      properties: {
        diffResponse: { type: "string", description: "The SEARCH/REPLACE blocks formatted text." },
        checkCommand: { type: "string", description: "Post-edit verification command (default: npx tsc --noEmit)" },
      },
      required: ["diffResponse"],
    },
  },
  {
    name: "search_code",
    description: "Runs high-speed ripgrep search for symbols or regex across all project files.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Symbol or text pattern to search." },
        isRegex: { type: "boolean", description: "Whether query is a regex." },
      },
      required: ["query"],
    },
  },
  {
    name: "git_diff",
    description: "Inspects uncommitted changes in the repository to review modified code.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
];

export class ToolExecutionHandler {
  public static async execute(
    sessionId: string,
    toolName: string,
    args: Record<string, any>
  ): Promise<{ success: boolean; output: string }> {
    try {
      switch (toolName) {
        case "create_directory": {
          const dirPath = args.path || args.dirPath || args.filePath || "";
          const res = await E2BSandboxManager.executeCommand(
            sessionId,
            `mkdir -p "${dirPath}"`,
            "/home/user/workspace"
          );
          return {
            success: res.exitCode === 0,
            output: res.exitCode === 0 ? `Directory '${dirPath}' created successfully.` : res.stderr,
          };
        }

        case "write_file": {
          const targetPath = args.filePath || args.path || "";
          await E2BSandboxManager.writeFile(sessionId, targetPath, args.content || "");
          return { success: true, output: `File '${targetPath}' written successfully.` };
        }

        case "read_file": {
          const content = await E2BSandboxManager.readFile(sessionId, args.filePath || args.path);
          return { success: true, output: content };
        }

        case "delete_file": {
          const target = args.filePath || args.path || "";
          const res = await E2BSandboxManager.executeCommand(
            sessionId,
            `rm -rf "${target}"`,
            "/home/user/workspace"
          );
          return {
            success: res.exitCode === 0,
            output: res.exitCode === 0 ? `Deleted '${target}' successfully.` : res.stderr,
          };
        }

        case "list_directory": {
          const target = args.path || ".";
          const res = await E2BSandboxManager.executeCommand(
            sessionId,
            `ls -la "${target}"`,
            "/home/user/workspace"
          );
          return { success: res.exitCode === 0, output: res.stdout || res.stderr };
        }

        case "exec_bash": {
          const res = await E2BSandboxManager.executeCommand(sessionId, args.command, args.cwd);
          const success = res.exitCode === 0;
          const output = `Exit Code: ${res.exitCode}\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`;
          return { success, output };
        }

        case "apply_diff": {
          const res = await EditVerificationService.applyAndVerify(sessionId, args.diffResponse, {
            checkCommand: args.checkCommand,
          });
          const output = `Applied: ${res.editApplied}\nVerified: ${res.verified}\nOutput: ${res.typeCheckOutput || res.errorMessage}`;
          return { success: res.verified, output };
        }

        case "search_code": {
          const matches = await FastCodeSearchService.ripgrep(sessionId, args.query, {
            isRegex: args.isRegex,
          });
          return { success: true, output: JSON.stringify(matches, null, 2) };
        }

        case "git_diff": {
          const res = await E2BSandboxManager.executeCommand(sessionId, "git diff", "/home/user/workspace");
          return { success: true, output: res.stdout || "No uncommitted git changes." };
        }

        default:
          return { success: false, output: `Unknown tool name: ${toolName}` };
      }
    } catch (err: any) {
      return { success: false, output: `Tool execution error: ${err.message}` };
    }
  }
}