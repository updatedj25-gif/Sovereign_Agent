export * from "./index";
export interface AgentContext {
  sessionId?: string;
  workspaceGroupId?: string;
}
export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}
export const executeTool = async (name: string, args: any) => {
  return { success: true, output: `Tool ${name} executed` };
};
