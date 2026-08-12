import { Router, Request, Response } from "express";
import { MCPClientManager, MCPServerConfig } from "../services/mcp-client-manager";

export const mcpRouter = Router();

/**
 * GET /api/mcp/servers
 * List connected external MCP servers
 */
mcpRouter.get("/servers", (req: Request, res: Response) => {
  const servers = MCPClientManager.getConnectedServers();
  return res.json({ servers });
});

/**
 * POST /api/mcp/connect
 * Connect a new external MCP server (Stdio or SSE)
 */
mcpRouter.post("/connect", async (req: Request, res: Response) => {
  try {
    const config: MCPServerConfig = req.body;

    if (!config.id || !config.name || !config.transport) {
      return res.status(400).json({ error: "id, name, and transport are required" });
    }

    await MCPClientManager.connectServer(config);
    return res.json({ success: true, message: `Connected to MCP server '${config.name}'` });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/mcp/servers/:id
 * Disconnect an MCP server
 */
mcpRouter.delete("/servers/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await MCPClientManager.disconnectServer(id);
    return res.json({ success: true, message: `Disconnected MCP server '${id}'` });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/mcp/tools
 * List all normalized tools from all connected MCP servers
 */
mcpRouter.get("/tools", async (req: Request, res: Response) => {
  try {
    const tools = await MCPClientManager.listAllNormalizedTools();
    return res.json({ tools });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/mcp/call-tool
 * Call a tool on an external MCP server
 */
mcpRouter.post("/call-tool", async (req: Request, res: Response) => {
  try {
    const { serverId, toolName, args } = req.body;

    if (!serverId || !toolName) {
      return res.status(400).json({ error: "serverId and toolName are required" });
    }

    const result = await MCPClientManager.callTool(serverId, toolName, args || {});
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});