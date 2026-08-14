import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { ToolDefinition } from "./agent-tools";

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface MCPToolCallResult {
  content: Array<{ type: string; text?: string; data?: any }>;
  isError?: boolean;
}

export class MCPClientManager {
  private static clients = new Map<string, Client>();
  private static serverConfigs = new Map<string, MCPServerConfig>();

  public static async connectServer(config: MCPServerConfig): Promise<void> {
    const client = new Client(
      {
        name: "sovereign-agent-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    if (config.transport === "stdio" && config.command) {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: config.env || (process.env as Record<string, string>),
      });
      await client.connect(transport);
    } else if (config.transport === "sse" && config.url) {
      const transport = new SSEClientTransport(new URL(config.url));
      await client.connect(transport);
    }

    this.clients.set(config.id, client);
    this.serverConfigs.set(config.id, config);
  }

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

  public static async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, any>
  ): Promise<MCPToolCallResult> {
    const client = this.clients.get(serverId);
    if (!client) throw new Error(`MCP Server '${serverId}' is not connected.`);

    const cleanToolName = toolName.includes("__") ? toolName.split("__").pop()! : toolName;
    const result = await client.callTool({ name: cleanToolName, arguments: args });

    return {
      content: result.content as Array<{ type: string; text?: string; data?: any }>,
      isError: !!result.isError,
    };
  }

  public static async disconnectServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (client) {
      try {
        await client.close();
      } catch (err) {
        console.error(`[MCP Manager] Error closing ${serverId}:`, err);
      } finally {
        this.clients.delete(serverId);
        this.serverConfigs.delete(serverId);
      }
    }
  }

  public static getConnectedServers(): MCPServerConfig[] {
    return Array.from(this.serverConfigs.values());
  }
}