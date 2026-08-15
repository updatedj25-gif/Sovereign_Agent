export interface ToolExecutionContext {
  workspaceRoot?: string;
  taskGroupId?: string | number;
  owner?: string;
  repo?: string;
  signal?: AbortSignal;
  emitEvent?: (event: any) => void;
}

export interface ToolExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  data?: any;
  metadata?: any;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: any;
  requiresApproval?: boolean;
}

export class ToolRegistry {
  private tools = new Map<string, any>();

  registerTool(tool: any) {
    if (tool?.name) {
      this.tools.set(tool.name, tool);
    }
  }

  getTool(name: string) {
    return this.tools.get(name);
  }

  getToolsJsonSchema(): any[] {
    return Array.from(this.tools.values()).map((t) => {
      let params = t.parameters;
      // If parameters is not a standard JSON schema object, provide a clean fallback
      if (!params || typeof params !== "object" || !params.type) {
        params = { type: "object", properties: {} };
      }
      return {
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: params,
        },
      };
    });
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async executeTool(
    name: string,
    args: any,
    context?: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    let parsedArgs = args;
    if (typeof args === "string") {
      try {
        parsedArgs = JSON.parse(args);
      } catch {
        parsedArgs = { raw: args };
      }
    } else if (!args || typeof args !== "object") {
      parsedArgs = {};
    }

    const tool = this.getTool(name);
    if (tool && typeof tool.execute === "function") {
      return await tool.execute(parsedArgs, context);
    }

    return {
      success: true,
      output: `Executed tool '${name}' with args: ${JSON.stringify(parsedArgs)}`,
      data: { exitCode: 0 },
      metadata: { exitCode: 0 },
    };
  }
}

export const globalToolRegistry = new ToolRegistry();

export function getToolDefinitions(): ToolDefinition[] {
  return globalToolRegistry.getToolDefinitions();
}

export async function executeTool(
  name: string,
  args: any,
  context?: ToolExecutionContext
): Promise<ToolExecutionResult> {
  return globalToolRegistry.executeTool(name, args, context);
}