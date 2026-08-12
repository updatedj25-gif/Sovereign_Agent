import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";

// Import Autonomous Agent Routers
import { sandboxRouter } from "./routes/sandbox";
import { perceptionRouter } from "./routes/perception";
import { editRouter } from "./routes/file-edit";
import { reactAgentRouter } from "./routes/react-agent";
import { contextRouter } from "./routes/context";
import { safetyRouter } from "./routes/safety";
import { mcpRouter } from "./routes/mcp";

const app: Express = express();
const PORT = process.env.PORT || 5000;

// Global Middlewares
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Request Logging Middleware
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

// ============================================================================
// Mount Autonomous Agent Subsystem Routers
// ============================================================================

// 1. Isolated Sandbox Execution Engine (E2B)
app.use("/api/sandbox", sandboxRouter);

// 2. Codebase Perception, AST & Vector Indexing
app.use("/api/perception", perceptionRouter);

// 3. Search/Replace Block Diff Engine & Verification
app.use("/api/edit", editRouter);

// 4. Autonomous ReAct Brain Loop & SSE Stream
app.use("/api/agent", reactAgentRouter);

// 5. Context Window Optimization & Token Budget Manager
app.use("/api/context", contextRouter);

// 6. HITL Safety Rules & Git Checkpoint Rollbacks
app.use("/api/safety", safetyRouter);

// 7. Model Context Protocol (MCP) Integration
app.use("/api/mcp", mcpRouter);

// ============================================================================
// Global Error Handler
// ============================================================================
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Fatal API Error]:", err.stack || err.message);
  res.status(500).json({
    error: "Internal Server Error",
    message: err.message,
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`
🚀 Sovereign Autonomous Agent API Server running on port ${PORT}
   - Sandbox Engine:  /api/sandbox
   - Code Perception: /api/perception
   - Diff Engine:     /api/edit
   - ReAct Brain:     /api/agent
   - Context Pruning: /api/context
   - HITL Safety:     /api/safety
   - MCP Protocol:    /api/mcp
  `);
});

export default app;