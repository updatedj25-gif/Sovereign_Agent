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
        case "exec_bash": {
          const res = await E2BSandboxManager.executeCommand(sessionId, args.command, args.cwd);
          const success = res.exitCode === 0;
          const output = `Exit Code: ${res.exitCode}\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`;
          return { success, output };
        }

        case "read_file": {
          const content = await E2BSandboxManager.readFile(sessionId, args.filePath);
          return { success: true, output: content };
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