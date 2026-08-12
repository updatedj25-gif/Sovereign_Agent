import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { ToolDefinition } from "./agent-tools";

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "sse";
  // Stdio config
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // SSE config
  url?: string;
}

export interface MCPToolCallResult {
  content: Array<{ type: string; text?: string; data?: any }>;
  isError?: boolean;
}

export class MCPClientManager {
  private static clients = new Map<string, Client>();
  private static serverConfigs = new Map<string, MCPServerConfig>();

  /**
   * Connect to an external MCP server (e.g. GitHub, Postgres, Puppeteer MCP)
   */
  public static async connectServer(config: MCPServerConfig): Promise<void> {
    console.log(`[MCP Manager] Connecting to MCP Server: ${config.name} (${config.transport})`);

    const client = new Client(
      {
        name: "sovereign-agent-client",
        version: "1.0.0",
      },
      {
        capabilities: {
          prompts: {},
          resources: {},
          tools: {},
        },
      }
    );

    if (config.transport === "stdio") {
      if (!config.command) {
        throw new Error(`Command is required for stdio transport on server ${config.id}`);
      }

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: config.env || (process.env as Record<string, string>),
      });

      await client.connect(transport);
    } else if (config.transport === "sse") {
      if (!config.url) {
        throw new Error(`URL is required for SSE transport on server ${config.id}`);
      }

      const transport = new SSEClientTransport(new URL(config.url));
      await client.connect(transport);
    } else {
      throw new Error(`Unsupported transport type: ${(config as any).transport}`);
    }

    this.clients.set(config.id, client);
    this.serverConfigs.set(config.id, config);
    console.log(`[MCP Manager] Successfully connected to MCP server: ${config.id}`);
  }

  /**
   * Fetch and normalize all tools from all connected MCP servers into Sovereign Agent's ToolDefinition format.
   */
  public static async listAllNormalizedTools(): Promise<ToolDefinition[]> {
    const allTools: ToolDefinition[] = [];

    for (const [serverId, client] of this.clients.entries()) {
      try {
        const mcpToolsResult = await client.listTools({});
        const serverConfig = this.serverConfigs.get(serverId);

        for (const tool of mcpToolsResult.tools) {
          allTools.push({
            name: `mcp__${serverId}__${tool.name}`,
            description: `[MCP: ${serverConfig?.name || serverId}] ${tool.description || ""}`,
            parameters: {
              type: "object",
              properties: (tool.inputSchema?.properties as Record<string, any>) || {},
              required: tool.inputSchema?.required as string[] | undefined,
            },
          });
        }
      } catch (err) {
        console.error(`[MCP Manager] Failed to list tools for server ${serverId}:`, err);
      }
    }

    return allTools;
  }

  /**
   * Call a tool on an external connected MCP server
   */
  public static async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, any>
  ): Promise<MCPToolCallResult> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`MCP Server '${serverId}' is not connected.`);
    }

    // Strip prefix if internal tool name format `mcp__serverId__toolName` was passed
    const cleanToolName = toolName.includes("__") ? toolName.split("__").pop()! : toolName;

    console.log(`[MCP Manager] Executing MCP tool '${cleanToolName}' on server '${serverId}'`);

    const result = await client.callTool({
      name: cleanToolName,
      arguments: args,
    });

    return {
      content: result.content as Array<{ type: string; text?: string; data?: any }>,
      isError: !!result.isError,
    };
  }

  /**
   * Safely disconnect an MCP server
   */
  public static async disconnectServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (client) {
      console.log(`[MCP Manager] Disconnecting MCP server: ${serverId}`);
      try {
        await client.close();
      } catch (err) {
        console.error(`[MCP Manager] Error closing MCP server ${serverId}:`, err);
      } finally {
        this.clients.delete(serverId);
        this.serverConfigs.delete(serverId);
      }
    }
  }

  /**
   * Get connection status for all registered servers
   */
  public static getConnectedServers(): MCPServerConfig[] {
    return Array.from(this.serverConfigs.values());
  }
}