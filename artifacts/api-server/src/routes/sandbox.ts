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

    // Find all files and directories excluding node_modules and .git
    const command = `find . -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "." | sort`;
    const exec = await E2BSandboxManager.executeCommand(sessionId, command, cwd);

    if (exec.exitCode !== 0) {
      return res.json({ tree: [] });
    }

    const paths = exec.stdout.split("\n").filter(Boolean);
    const rootNodes: FileNode[] = [];

    // Helper to build nested tree structure from paths
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
 * Returns forwarded HTTPS preview URL for web server running inside E2B (e.g. Vite port 5173)
 */
sandboxRouter.get("/preview-url", async (req: Request, res: Response) => {
  try {
    const sessionId = (req.query.sessionId as string) || "default-session";
    const port = parseInt((req.query.port as string) || "5173", 10);

    const sandbox = await E2BSandboxManager.getOrCreate(sessionId);
    
    // E2B JS SDK method for forwarded host port
    const forwardedHost = sandbox.getHost(port);
    const previewUrl = `https://${forwardedHost}`;

    return res.json({
      sessionId,
      port,
      previewUrl,
      isForwarded: true,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/sandbox/exec
 */
sandboxRouter.post("/exec", async (req: Request, res: Response) => {
  try {
    const { sessionId, command, cwd } = req.body;
    if (!sessionId || !command) {
      return res.status(400).json({ error: "sessionId and command required" });
    }
    const result = await E2BSandboxManager.executeCommand(sessionId, command, cwd);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});    const { sessionId, action, filePath, content } = req.body;

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
