import { z } from "zod";

/**
 * Context provided to tools during execution.
 */
export interface ToolExecutionContext {
  taskGroupId?: number;
  owner?: string;
  repo?: string;
  workingDir?: string;
  signal?: AbortSignal;
  emitEvent?: (data: Record<string, any>) => void;
}

/**
 * Standardized result returned by tool execution.
 */
export interface ToolExecutionResult {
  success: boolean;
  output: string;
  data?: Record<string, any>;
  error?: string;
}

/**
 * Definition interface for an individual agent tool.
 */
export interface AgentTool<TParams extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  parameters: TParams;
  requiresApproval?: boolean;
  execute: (args: z.infer<TParams>, context: ToolExecutionContext) => Promise<ToolExecutionResult>;
}

/**
 * Tool representation formatted for LLM Function/Tool Calling Specs.
 */
export interface ToolJsonSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

/**
 * Central registry for registering, parsing, and dispatching agent tools.
 */
export class ToolRegistry {
  private tools: Map<string, AgentTool> = new Map();

  /**
   * Register a new tool into the registry.
   */
  registerTool<TParams extends z.ZodTypeAny>(tool: AgentTool<TParams>): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[ToolRegistry] Overwriting existing tool registration: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as unknown as AgentTool);
  }

  /**
   * Retrieve a tool by name.
   */
  getTool(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  /**
   * List all registered tool instances.
   */
  listTools(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Export registered tools in OpenAPI / OpenAI JSON Schema function call format.
   */
  getToolsJsonSchema(): ToolJsonSchema[] {
    return Array.from(this.tools.values()).map((tool) => {
      const zodSchema = tool.parameters;
      // Convert Zod schema to raw JSON schema block
      const jsonSchema = zodSchemaToSimpleJsonSchema(zodSchema);

      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: jsonSchema,
        },
      };
    });
  }

  /**
   * Safely execute a registered tool with argument validation and error handling.
   */
  async executeTool(
    name: string,
    rawArgs: Record<string, any> | string,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        output: `Error: Tool '${name}' is not registered in the tool registry.`,
        error: "TOOL_NOT_FOUND",
      };
    }

    try {
      // Normalize raw JSON string input if needed
      const parsedRaw = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;

      // Validate parameters against Zod schema
      const validatedArgs = tool.parameters.parse(parsedRaw);

      // Execute tool implementation
      return await tool.execute(validatedArgs, context);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        const issues = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        return {
          success: false,
          output: `Error validating arguments for tool '${name}': ${issues}`,
          error: "INVALID_TOOL_ARGUMENTS",
        };
      }

      return {
        success: false,
        output: `Execution error in tool '${name}': ${err.message || String(err)}`,
        error: "TOOL_EXECUTION_FAILED",
      };
    }
  }
}

/**
 * Minimal helper converting Zod schema object definitions to lightweight JSON Schema.
 */
function zodSchemaToSimpleJsonSchema(schema: z.ZodTypeAny): Record<string, any> {
  if ("shape" in schema && typeof (schema as any).shape === "object") {
    const shape = (schema as any).shape;
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const fieldSchema = value as z.ZodTypeAny;
      properties[key] = convertZodField(fieldSchema);

      if (!fieldSchema.isOptional()) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  return { type: "object", properties: {} };
}

function convertZodField(field: z.ZodTypeAny): Record<string, any> {
  let unwrapped = field;
  let isOptional = false;

  while ("_def" in unwrapped) {
    const def = unwrapped._def as any;
    if (def.typeName === "ZodOptional" || def.typeName === "ZodNullable") {
      isOptional = true;
      unwrapped = def.innerType;
    } else {
      break;
    }
  }

  const def = unwrapped._def as any;
  const description = field.description || unwrapped.description;

  let fieldType = "string";
  if (def.typeName === "ZodNumber") fieldType = "number";
  if (def.typeName === "ZodBoolean") fieldType = "boolean";
  if (def.typeName === "ZodArray") fieldType = "array";
  if (def.typeName === "ZodObject") fieldType = "object";

  return {
    type: fieldType,
    ...(description ? { description } : {}),
  };
}

/** Default singleton instance */
export const globalToolRegistry = new ToolRegistry();