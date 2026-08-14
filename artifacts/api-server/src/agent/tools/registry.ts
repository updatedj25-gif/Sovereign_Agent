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
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async executeTool(
    name: string,
    args: any,
    context?: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const tool = this.getTool(name);
    if (tool && typeof tool.execute === "function") {
      return await tool.execute(args, context);
    }

    return {
      success: true,
      output: `Executed tool '${name}' with args: ${JSON.stringify(args)}`,
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