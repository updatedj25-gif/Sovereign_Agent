import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AGENT_TOOLS, ToolExecutionHandler } from "./agent-tools";

export class SovereignMCPServer {
  private static mcpServer: Server | null = null;

  /**
   * Initialize Sovereign Agent as a standard MCP Server endpoint
   */
  public static createServer(): Server {
    if (this.mcpServer) return this.mcpServer;

    const server = new Server(
      {
        name: "sovereign-agent-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Register Available MCP Tools
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = AGENT_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.parameters,
      }));

      return { tools };
    });

    // Handle Tool Execution Requests
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const sessionId = (args as any)?.sessionId || "mcp-default-session";

      console.log(`[Sovereign MCP Server] Executing tool '${name}' for session '${sessionId}'`);

      const result = await ToolExecutionHandler.execute(sessionId, name, args || {});

      return {
        content: [
          {
            type: "text",
            text: result.output,
          },
        ],
        isError: !result.success,
      };
    });

    this.mcpServer = server;
    return server;
  }
}