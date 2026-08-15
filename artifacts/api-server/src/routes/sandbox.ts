import { Router, Request, Response } from "express";
import { E2BSandboxManager } from "../services/e2b-sandbox";

export const sandboxRouter = Router();

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
}

/**
 * GET /api/sandbox/tree
 * Scans E2B container workspace and returns structured directory tree
 */
sandboxRouter.get("/tree", async (req: Request, res: Response) => {
  try {
    const sessionId = (req.query.sessionId as string) || "default-session";
    const cwd = "/home/user/workspace";

    const command = `find . -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "." | sort`;
    const exec = await E2BSandboxManager.executeCommand(sessionId, command, cwd);

    if (exec.exitCode !== 0) {
      return res.json({ tree: [] });
    }

    const paths = exec.stdout.split("\n").filter(Boolean);
    const rootNodes: FileNode[] = [];
    const nodeMap = new Map<string, FileNode>();

    for (const rawPath of paths) {
      const cleanPath = rawPath.replace("./", "");
      const segments = cleanPath.split("/");
      const isDir = !cleanPath.includes(".") || rawPath.endsWith("/");

      const node: FileNode = {
        name: segments[segments.length - 1],
        path: cleanPath,
        type: isDir ? "dir" : "file",
        children: isDir ? [] : undefined,
      };

      nodeMap.set(cleanPath, node);

      if (segments.length === 1) {
        rootNodes.push(node);
      } else {
        const parentPath = segments.slice(0, -1).join("/");
        const parentNode = nodeMap.get(parentPath);
        if (parentNode && parentNode.children) {
          parentNode.children.push(node);
        } else {
          rootNodes.push(node);
        }
      }
    }

    return res.json({ tree: rootNodes });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/sandbox/preview-url
 * Returns forwarded HTTPS preview URL and checks if a service is actively listening on the port
 */
sandboxRouter.get("/preview-url", async (req: Request, res: Response) => {
  try {
    const sessionId = (req.query.sessionId as string) || "default-session";
    const port = parseInt((req.query.port as string) || "5173", 10);

    const sandbox = await E2BSandboxManager.getOrCreate(sessionId);
    const forwardedHost = sandbox.getHost(port);
    const previewUrl = `https://${forwardedHost}`;

    // Check if the service is actively listening on the specified port
    let isListening = false;
    try {
      const checkRes = await E2BSandboxManager.executeCommand(
        sessionId,
        `nc -z -w 1 127.0.0.1 ${port} >/dev/null 2>&1 && echo "LISTENING" || (curl -s -m 1 http://127.0.0.1:${port} >/dev/null 2>&1 && echo "LISTENING" || echo "STOPPED")`,
        "/home/user/workspace",
        3000
      );
      isListening = checkRes.stdout.includes("LISTENING");
    } catch {
      isListening = false;
    }

    return res.json({
      sessionId,
      port,
      previewUrl,
      isForwarded: true,
      isListening,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/sandbox/start-dev
 * Starts a live web dev server on port 5173 inside the sandbox
 */
sandboxRouter.post("/start-dev", async (req: Request, res: Response) => {
  try {
    const sessionId = req.body?.sessionId || "default-session";
    const port = parseInt(req.body?.port || "5173", 10);

    // Launch background server (e.g. npx vite or python3 http.server or static server if no vite)
    const launchCmd = `
      if [ -f "package.json" ]; then
        (nohup npm run dev -- --host 0.0.0.0 --port ${port} > /tmp/devserver.log 2>&1 &) || (nohup npx vite --host 0.0.0.0 --port ${port} > /tmp/devserver.log 2>&1 &)
      else
        echo "<h1>Sovereign Agent Workspace</h1><p>Sandbox live on port ${port}</p>" > index.html
        (nohup python3 -m http.server ${port} --bind 0.0.0.0 > /tmp/devserver.log 2>&1 &) || (nohup npx http-server -p ${port} -a 0.0.0.0 > /tmp/devserver.log 2>&1 &)
      fi
      sleep 1
    `;

    const result = await E2BSandboxManager.executeCommand(sessionId, launchCmd, "/home/user/workspace");
    const sandbox = await E2BSandboxManager.getOrCreate(sessionId);
    const forwardedHost = sandbox.getHost(port);

    return res.json({
      success: true,
      previewUrl: `https://${forwardedHost}`,
      output: result.stdout || "Dev server launch initiated.",
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/sandbox/exec
 * Executes shell commands in the sandbox
 */
sandboxRouter.post("/exec", async (req: Request, res: Response) => {
  try {
    const { sessionId, command, cwd } = req.body;

    if (!sessionId || !command) {
      return res.status(400).json({ error: "sessionId and command are required" });
    }

    const result = await E2BSandboxManager.executeCommand(sessionId, command, cwd);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/sandbox/file
 * Reads or writes code files inside the sandbox workspace
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