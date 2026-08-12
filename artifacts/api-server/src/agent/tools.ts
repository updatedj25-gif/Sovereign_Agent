import fs from "node:fs/promises";
import path from "node:path";
import { SandboxExecutor } from "../services/sandbox/executor";
import { CommandSecurityValidator } from "../services/sandbox/security";
import { SearchReplaceEngine } from "../services/diff-patch/search-replace";
import { hitlGateService } from "../services/hitl-gate";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read the full contents of a file relative to project root.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Path to the file" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "write_file",
    description: "Create or completely overwrite a file with content.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Path to file" },
        content: { type: "string", description: "File content" },
      },
      required: ["filePath", "content"],
    },
  },
  {
    name: "apply_diff",
    description: "Apply precision search-and-replace block edits to a file.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "File path to patch" },
        blocks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              search: { type: "string", description: "Exact string segment to replace" },
              replace: { type: "string", description: "New replacement string segment" },
            },
            required: ["search", "replace"],
          },
        },
      },
      required: ["filePath", "blocks"],
    },
  },
  {
    name: "execute_command",
    description: "Execute a terminal bash command in the isolated workspace sandbox.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command line string to run" },
        cwd: { type: "string", description: "Optional relative working directory" },
      },
      required: ["command"],
    },
  },
  {
    name: "list_directory",
    description: "List directory structure and items at a path.",
    parameters: {
      type: "object",
      properties: {
        dirPath: { type: "string", description: "Directory relative path" },
      },
      required: ["dirPath"],
    },
  },
];

export class ToolDispatcher {
  static async executeTool(name: string, args: any): Promise<any> {
    switch (name) {
      case "read_file": {
        const fullPath = path.resolve(args.filePath);
        const content = await fs.readFile(fullPath, "utf-8");
        return { filePath: args.filePath, content };
      }

      case "write_file": {
        const fullPath = path.resolve(args.filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, args.content, "utf-8");
        return { filePath: args.filePath, success: true, bytesWritten: args.content.length };
      }

      case "apply_diff": {
        return await SearchReplaceEngine.applyPatch(args.filePath, args.blocks);
      }

      case "execute_command": {
        const secCheck = CommandSecurityValidator.validate(args.command);
        if (!secCheck.allowed) {
          throw new Error(secCheck.reason);
        }

        if (secCheck.requiresHITL) {
          const req = hitlGateService.createApprovalRequest(
            args.command,
            secCheck.reason || "Action requires user verification"
          );
          return {
            status: "approval_required",
            approvalId: req.id,
            command: args.command,
            message: "Action requires manual client confirmation.",
          };
        }

        return await SandboxExecutor.runCommand(args.command, { cwd: args.cwd });
      }

      case "list_directory": {
        const fullPath = path.resolve(args.dirPath || ".");
        const entries = await fs.readdir(fullPath, { withFileTypes: true });
        return entries.map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
          isFile: e.isFile(),
        }));
      }

      default:
        throw new Error(`Unknown tool requested: ${name}`);
    }
  }
}