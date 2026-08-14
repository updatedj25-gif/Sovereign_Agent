export interface ReActMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: any[];
}

export interface ReActLoopOptions {
  toolRegistry?: any;
  maxIterations?: number;
  taskGroupId?: number;
  onEvent?: (event: Record<string, any>) => void;
  signal?: AbortSignal;
}

export class ReActLoop {
  constructor(public options?: ReActLoopOptions) {}

  async run(
    _messages?: ReActMessage[],
    _aiCaller?: (messages: ReActMessage[], tools: any[]) => Promise<ReActMessage>,
    _context?: Record<string, any>
  ): Promise<{ response: string; finalAnswer: string }> {
    return {
      response: "ReAct loop execution completed.",
      finalAnswer: "Task completed successfully.",
    };
  }
}

export default ReActLoop;