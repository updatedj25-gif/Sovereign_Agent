import { ToolRegistry, ToolExecutionContext } from "./tools/registry";

export interface ReActMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface ReActLoopOptions {
  modelProvider: (messages: ReActMessage[], tools: any[]) => Promise<ReActMessage>;
  toolRegistry: ToolRegistry;
  maxIterations?: number;
  taskGroupId?: number;
  onEvent?: (data: Record<string, any>) => void;
  signal?: AbortSignal;
}

export interface ReActLoopResult {
  completed: boolean;
  finalAnswer: string;
  stepsCount: number;
  history: ReActMessage[];
}

/**
 * ReAct (Reasoning + Acting) loop executor.
 * Dynamically interleave LLM reasoning with tool call execution.
 */
export class ReActLoop {
  private toolRegistry: ToolRegistry;
  private maxIterations: number;
  private onEvent?: (data: Record<string, any>) => void;
  private taskGroupId?: number;

  constructor(options: Omit<ReActLoopOptions, "modelProvider">) {
    this.toolRegistry = options.toolRegistry;
    this.maxIterations = options.maxIterations || 12;
    this.onEvent = options.onEvent;
    this.taskGroupId = options.taskGroupId;
  }

  private emit(event: Record<string, any>) {
    if (this.onEvent) {
      this.onEvent(event);
    }
  }

  /**
   * Run the ReAct execution cycle.
   */
  async run(
    initialMessages: ReActMessage[],
    modelProvider: (messages: ReActMessage[], tools: any[]) => Promise<ReActMessage>,
    contextExtra?: Partial<ToolExecutionContext>
  ): Promise<ReActLoopResult> {
    const history: ReActMessage[] = [...initialMessages];
    const toolsJson = this.toolRegistry.getToolsJsonSchema();

    this.emit({ type: "analysis_started" });

    let iteration = 0;
    let finalAnswer = "";
    let completed = false;

    const executionContext: ToolExecutionContext = {
      taskGroupId: this.taskGroupId,
      emitEvent: (evt) => this.emit(evt),
      ...contextExtra,
    };

    while (iteration < this.maxIterations) {
      if (contextExtra?.signal?.aborted) {
        this.emit({ type: "error", error: "Execution aborted by client signal." });
        return { completed: false, finalAnswer: "Execution aborted.", stepsCount: iteration, history };
      }

      iteration++;

      // 1. Query LLM for reasoning / next step action
      let responseMessage: ReActMessage;
      try {
        responseMessage = await modelProvider(history, toolsJson);
      } catch (err: any) {
        const errorMsg = `LLM Provider Error: ${err.message || String(err)}`;
        this.emit({ type: "error", error: errorMsg });
        return { completed: false, finalAnswer: errorMsg, stepsCount: iteration, history };
      }

      history.push(responseMessage);

      // Emitting reasoning output if content exists
      if (responseMessage.content && responseMessage.content.trim()) {
        this.emit({
          type: "task_progress",
          task: `Step ${iteration}`,
          output: responseMessage.content,
        });
      }

      // 2. Check for tool calls
      const toolCalls = responseMessage.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        // No further tool calls requested -> Agent reached final answer
        finalAnswer = responseMessage.content || "Task processing finished.";
        completed = true;
        break;
      }

      // 3. Execute requested tool calls sequentially
      for (const call of toolCalls) {
        const toolName = call.function.name;
        const rawArgs = call.function.arguments;

        this.emit({
          type: "task_running",
          task: `Executing tool: ${toolName}`,
          tool: toolName,
          arguments: rawArgs,
        });

        // Execute tool via tool registry
        const result = await this.toolRegistry.executeTool(toolName, rawArgs, executionContext);

        // Notify client of completion of tool call step
        this.emit({
          type: result.success ? "task_completed" : "task_failed",
          task: toolName,
          summary: result.output.slice(0, 300),
          output: result.output,
        });

        // 4. Feed tool result observation back into conversation context
        history.push({
          role: "tool",
          name: toolName,
          content: JSON.stringify({
            success: result.success,
            output: result.output,
            data: result.data || null,
            error: result.error || null,
          }),
        });
      }
    }

    if (!completed && iteration >= this.maxIterations) {
      finalAnswer = `Reached maximum execution depth (${this.maxIterations} steps) without explicit termination.`;
      this.emit({
        type: "task_completed",
        task: "Max Depth Reached",
        summary: finalAnswer,
      });
    }

    this.emit({ type: "stream_finished" });

    return {
      completed,
      finalAnswer,
      stepsCount: iteration,
      history,
    };
  }
}