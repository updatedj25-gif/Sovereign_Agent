import "dotenv/config"; 
import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";

// Subsystem Routers
import { githubRouter } from "./routes/github";
import { sandboxRouter } from "./routes/sandbox";
import { perceptionRouter } from "./routes/perception";
import { editRouter } from "./routes/file-edit";
import { reactAgentRouter } from "./routes/react-agent";
import { contextRouter } from "./routes/context";
import { safetyRouter } from "./routes/safety";
import { mcpRouter } from "./routes/mcp";

const app: Express = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Logging Middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health Check Endpoint
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "Sovereign Agent API Server",
    version: "2.0.0",
    features: [
      "GitHub REST Proxy & AST Patching",
      "E2B Sandbox Execution Engine",
      "AST & Ripgrep Code Perception",
      "Fuzzy Search/Replace Diff Engine",
      "Autonomous ReAct Brain Loop",
      "Smart Context Window Pruning",
      "HITL Safety & Git Checkpoints",
      "Model Context Protocol (MCP)",
    ],
  });
});

// Mount Backend Routers
app.use("/api/github", githubRouter);
app.use("/api/sandbox", sandboxRouter);
app.use("/api/perception", perceptionRouter);
app.use("/api/edit", editRouter);
app.use("/api/agent", reactAgentRouter);
app.use("/api/context", contextRouter);
app.use("/api/safety", safetyRouter);
app.use("/api/mcp", mcpRouter);

// Express 5 Fallback 404
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({
      error: "Not Found",
      message: "The requested API route does not exist.",
    });
  }
  next();
});

// Global Error Handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Fatal API Error]:", err.stack || err.message);
  res.status(500).json({ error: "Internal Server Error", message: err.message });
});

export default app;