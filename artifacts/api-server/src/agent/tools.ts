import { sandboxService } from "../services/sandbox";
import * as path from "node:path";

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON Schema format
  isDangerous?: boolean | ((params: any) => boolean); // Requires HITL approval
  execute: (
    taskGroupId: string,
    params: any
  ) => Promise<{ success: boolean; output: string; error?: string }>;
}

/**
 * Danger detection helpers
 */
export function isCommandDangerous(command: string): boolean {
  if (!command || typeof command !== "string") return false;
  const cmd = command.trim();

  const dangerousPatterns = [
    /\brm\s+-[rRfF]/i,
    /rm\s+-[rRfF]+\s+[\/*]/i,
    /\bsudo\b/i,
    /\bchmod\b/i,
    /\bchown\b/i,
    /git\s+push\s+.*--force/i,
    /git\s+push\s+.*-f\b/i,
    /drop\s+database/i,
    /drop\s+table/i,
    />\s*\.env/i,
    /export\s+[A-Za-z0-9_]*SECRET/i,
    /export\s+[A-Za-z0-9_]*KEY/i,
    /\bcurl\b/i,
    /\bwget\b/i,
  ];

  return dangerousPatterns.some((pattern) => pattern.test(cmd));
}

export function isPathSensitive(filePath: string): boolean {
  if (!filePath || typeof filePath !== "string") return false;
  const baseName = path.basename(filePath).toLowerCase();
  const sensitiveFiles = [
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    "package.json",
    "wrangler.toml",
    "dockerfile",
    "docker-compose.yml",
    "tsconfig.json",
    "firebase.json",
    "firestore.rules",
  ];
  return sensitiveFiles.includes(baseName) || baseName.startsWith(".env");
}

/**
 * Core Tools
 */

export const executeBashTool: AgentTool = {
  name: "execute_bash",
  description: "Runs a shell command in the task's sandbox workspace. Returns stdout/stderr and exit code.",
  isDangerous: (params) => {
    const cmd = params?.command || params?.cmd || "";
    return isCommandDangerous(cmd);
  },
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute in the sandbox workspace.",
      },
      timeoutMs: {
        type: "number",
        description: "Execution timeout in milliseconds (default: 120000).",
      },
    },
    required: ["command"],
  },
  execute: async (taskGroupId, params) => {
    const command = params?.command || params?.cmd;
    const timeoutMs = params?.timeoutMs || 120000;

    if (!command || typeof command !== "string") {
      return { success: false, output: "", error: "Parameter 'command' must be a valid non-empty string." };
    }

    let stdoutAcc = "";
    let stderrAcc = "";

    try {
      const res = await sandboxService.executeCommand(
        taskGroupId,
        command,
        (stdout) => {
          stdoutAcc += stdout;
        },
        (stderr) => {
          stderrAcc += stderr;
        },
        timeoutMs
      );

      const combinedOutput = [stdoutAcc, stderrAcc].filter(Boolean).join("\n").trim();
      const output = combinedOutput || `Command finished with exit code ${res.exitCode}`;

      if (res.exitCode === 0) {
        return { success: true, output };
      } else {
        return {
          success: false,
          output,
          error: `Command failed with exit code ${res.exitCode}`,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        output: [stdoutAcc, stderrAcc].filter(Boolean).join("\n").trim(),
        error: `Execution error: ${err.message || String(err)}`,
      };
    }
  },
};

export const readFileTool: AgentTool = {
  name: "read_file",
  description: "Reads content of a file within the sandbox directory.",
  isDangerous: false,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to read relative to workspace.",
      },
    },
    required: ["path"],
  },
  execute: async (taskGroupId, params) => {
    const filePath = params?.path || params?.filePath;
    if (!filePath || typeof filePath !== "string") {
      return { success: false, output: "", error: "Parameter 'path' must be a valid string." };
    }

    try {
      const content = await sandboxService.readFile(taskGroupId, filePath);
      return { success: true, output: content };
    } catch (err: any) {
      return {
        success: false,
        output: "",
        error: `File not found: Unable to read '${filePath}' - ${err.message || String(err)}`,
      };
    }
  },
};

export const writeFileTool: AgentTool = {
  name: "write_file",
  description: "Writes or overwrites file content in the sandbox directory.",
  isDangerous: (params) => {
    const targetPath = params?.path || params?.filePath || "";
    return isPathSensitive(targetPath);
  },
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to write/overwrite.",
      },
      content: {
        type: "string",
        description: "The text content to write to the file.",
      },
    },
    required: ["path", "content"],
  },
  execute: async (taskGroupId, params) => {
    const filePath = params?.path || params?.filePath;
    const content = params?.content;

    if (!filePath || typeof filePath !== "string") {
      return { success: false, output: "", error: "Parameter 'path' must be a valid string." };
    }
    if (content === undefined || content === null) {
      return { success: false, output: "", error: "Parameter 'content' is required." };
    }

    try {
      await sandboxService.writeFile(taskGroupId, filePath, String(content));
      return { success: true, output: `Successfully wrote file to '${filePath}'` };
    } catch (err: any) {
      return {
        success: false,
        output: "",
        error: `Failed to write file '${filePath}': ${err.message || String(err)}`,
      };
    }
  },
};

export const replaceStringTool: AgentTool = {
  name: "replace_string",
  description: "Safely performs targeted string replacement in a file within the sandbox directory.",
  isDangerous: (params) => {
    const targetPath = params?.path || params?.filePath || "";
    return isPathSensitive(targetPath);
  },
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the target file.",
      },
      old_str: {
        type: "string",
        description: "The exact target string to be replaced.",
      },
      new_str: {
        type: "string",
        description: "The replacement string.",
      },
    },
    required: ["path", "old_str", "new_str"],
  },
  execute: async (taskGroupId, params) => {
    const filePath = params?.path || params?.filePath;
    const oldStr = params?.old_str ?? params?.oldStr ?? params?.targetContent;
    const newStr = params?.new_str ?? params?.newStr ?? params?.replacementContent;

    if (!filePath || typeof filePath !== "string") {
      return { success: false, output: "", error: "Parameter 'path' must be a valid string." };
    }
    if (oldStr === undefined || oldStr === null || typeof oldStr !== "string") {
      return { success: false, output: "", error: "Parameter 'old_str' must be a non-empty string." };
    }
    if (newStr === undefined || newStr === null || typeof newStr !== "string") {
      return { success: false, output: "", error: "Parameter 'new_str' must be a string." };
    }

    try {
      const fileContent = await sandboxService.readFile(taskGroupId, filePath);

      if (!fileContent.includes(oldStr)) {
        return {
          success: false,
          output: "",
          error: `Target string not found in '${filePath}'. Make sure old_str matches exact file contents.`,
        };
      }

      const updatedContent = fileContent.replace(oldStr, newStr);
      await sandboxService.writeFile(taskGroupId, filePath, updatedContent);

      return {
        success: true,
        output: `Successfully replaced string in '${filePath}'`,
      };
    } catch (err: any) {
      return {
        success: false,
        output: "",
        error: `File replacement failed for '${filePath}': ${err.message || String(err)}`,
      };
    }
  },
};

export const directoryListTool: AgentTool = {
  name: "directory_list",
  description: "Lists directory contents with file/folder indicators in the sandbox workspace.",
  isDangerous: false,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative directory path (defaults to '.' for workspace root).",
      },
    },
  },
  execute: async (taskGroupId, params) => {
    const dirPath = params?.path || params?.directoryPath || ".";

    let stdoutAcc = "";
    let stderrAcc = "";

    try {
      const cmd = `ls -la ${dirPath}`;
      const res = await sandboxService.executeCommand(
        taskGroupId,
        cmd,
        (out) => { stdoutAcc += out; },
        (err) => { stderrAcc += err; }
      );

      if (res.exitCode !== 0) {
        return {
          success: false,
          output: stderrAcc.trim(),
          error: `Directory not found or inaccessible: '${dirPath}'`,
        };
      }

      return {
        success: true,
        output: stdoutAcc.trim() || `Directory listing for '${dirPath}' completed.`,
      };
    } catch (err: any) {
      return {
        success: false,
        output: "",
        error: `Failed to list directory '${dirPath}': ${err.message || String(err)}`,
      };
    }
  },
};

export const grepSearchTool: AgentTool = {
  name: "grep_search",
  description: "Searches for pattern across workspace files using grep search.",
  isDangerous: false,
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Text or regex pattern to search for.",
      },
      path: {
        type: "string",
        description: "Directory or file path to search within (defaults to '.').",
      },
    },
    required: ["query"],
  },
  execute: async (taskGroupId, params) => {
    const query = params?.query;
    const searchPath = params?.path || params?.searchPath || ".";

    if (!query || typeof query !== "string") {
      return { success: false, output: "", error: "Parameter 'query' must be a valid string." };
    }

    let stdoutAcc = "";
    let stderrAcc = "";

    const safeQuery = query.replace(/'/g, "'\\''");
    const cmd = `grep -rnI --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist '${safeQuery}' ${searchPath}`;

    try {
      const res = await sandboxService.executeCommand(
        taskGroupId,
        cmd,
        (out) => { stdoutAcc += out; },
        (err) => { stderrAcc += err; }
      );

      // grep returns exit code 1 if no matches found
      if (res.exitCode === 1 && !stderrAcc.trim()) {
        return { success: true, output: `No matches found for pattern '${query}'.` };
      }

      if (res.exitCode !== 0 && res.exitCode !== 1) {
        return {
          success: false,
          output: stderrAcc.trim(),
          error: `Grep search failed with exit code ${res.exitCode}`,
        };
      }

      return {
        success: true,
        output: stdoutAcc.trim() || `No matches found for pattern '${query}'.`,
      };
    } catch (err: any) {
      return {
        success: false,
        output: "",
        error: `Search failed: ${err.message || String(err)}`,
      };
    }
  },
};

/**
 * Tool Registry Class
 */
export class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  constructor() {
    // Register 6 core tools
    this.register(executeBashTool);
    this.register(readFileTool);
    this.register(writeFileTool);
    this.register(replaceStringTool);
    this.register(directoryListTool);
    this.register(grepSearchTool);

    // Register alias names for backward compatibility
    this.register({
      ...executeBashTool,
      name: "bash",
    });
    this.register({
      ...directoryListTool,
      name: "list_dir",
    });
  }

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  getAll(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  isToolDangerous(name: string, params: any): boolean {
    const tool = this.tools.get(name);
    if (!tool) return false;
    if (typeof tool.isDangerous === "function") {
      return tool.isDangerous(params);
    }
    return !!tool.isDangerous;
  }

  getToolDefinitionsForLLM() {
    // Exclude duplicates/aliases when exporting schemas to LLMs
    const uniqueTools = Array.from(new Set(this.tools.values()));
    return uniqueTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  async executeTool(
    name: string,
    taskGroupId: string,
    params: any
  ): Promise<{ success: boolean; output: string; error?: string }> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        output: "",
        error: `Tool '${name}' not found in registry. Available tools: ${Array.from(this.tools.keys()).join(", ")}`,
      };
    }

    try {
      return await tool.execute(taskGroupId, params);
    } catch (err: any) {
      return {
        success: false,
        output: "",
        error: `Unhandled execution error in tool '${name}': ${err.message || String(err)}`,
      };
    }
  }
}

export const toolRegistry = new ToolRegistry();

export function getToolsRegistry(): ToolRegistry {
  return toolRegistry;
}

export function getToolSchemasForLLM() {
  return toolRegistry.getToolDefinitionsForLLM();
}
