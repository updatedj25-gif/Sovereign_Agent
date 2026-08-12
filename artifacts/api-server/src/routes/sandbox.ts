import { Router, Request, Response } from "express";
import { E2BSandboxManager } from "../services/e2b-sandbox";

export const sandboxRouter = Router();

/**
 * POST /api/sandbox/exec
 * Executes shell commands in the sandbox (e.g., pnpm test, tsc, npm run build)
 */
sandboxRouter.post("/exec", async (req: Request, res: Response) => {
  try {
    const { sessionId, command, cwd } = req.body;

    if (!sessionId || !command) {
      return res
        .status(400)
        .json({ error: "sessionId and command are required" });
    }

    const result = await E2BSandboxManager.executeCommand(
      sessionId,
      command,
      cwd
    );
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/sandbox/file
 * Writes or reads code files inside the sandbox workspace
 */
sandboxRouter.post("/file", async (req: Request, res: Response) => {
  try {
    const { sessionId, action, filePath, content } = req.body;

    if (!sessionId || !filePath || !action) {
      return res.status(400).json({ error: "Missing required params" });
    }

    if (action === "write") {
      await E2BSandboxManager.writeFile(sessionId, filePath, content || "");
      return res.json({ success: true, message: `File written: ${filePath}` });
    } else if (action === "read") {
      const fileData = await E2BSandboxManager.readFile(sessionId, filePath);
      return res.json({ success: true, content: fileData });
    } else {
      return res.status(400).json({ error: "Action must be 'read' or 'write'" });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/sandbox/:sessionId
 * Destroys the E2B sandbox instance upon session end
 */
sandboxRouter.delete("/:sessionId", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    await E2BSandboxManager.killSession(sessionId);
    return res.json({ success: true, message: `Sandbox ${sessionId} destroyed` });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});