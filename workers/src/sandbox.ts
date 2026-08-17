import { Sandbox } from "e2b";
import { FileItem } from "./types";

export function cleanPath(raw: string): string {
  let p = raw.trim();
  p = p.replace(/^\/home\/user\/?/i, "");
  p = p.replace(/^\.\//, "");
  p = p.replace(/^\/+/, "");
  p = p.replace(/^it\//i, "");
  return p;
}

export function cleanBlockContent(raw: string): string {
  let clean = raw.trim();
  clean = clean.replace(/^```(?:python|py|bash|sh|javascript|js|tsx|ts|json|html|css)?\s*\n?/i, "");
  clean = clean.replace(/\n?```\s*$/i, "");
  return clean.trim();
}

export class SandboxManager {
  private e2bSandboxId: string | null = null;
  private apiKey: string | null = null;
  private memoryFiles: Record<string, { content: string; type: "file" | "directory" }> = {};

  constructor(apiKey?: string, initialSandboxId?: string, initialFiles?: Record<string, any>) {
    this.apiKey = apiKey ? apiKey.trim() : null;
    this.e2bSandboxId = initialSandboxId || null;
    if (initialFiles) this.memoryFiles = initialFiles;
  }

  public getSandboxId(): string | null {
    return this.e2bSandboxId;
  }

  public getMemoryFiles(): Record<string, { content: string; type: "file" | "directory" }> {
    return this.memoryFiles;
  }

  public async getSandboxInstance(): Promise<Sandbox | null> {
    if (!this.apiKey) return null;
    try {
      if (this.e2bSandboxId) {
        try {
          return await Sandbox.connect(this.e2bSandboxId, { apiKey: this.apiKey });
        } catch {
          console.log("[E2B] Reconnecting to sandbox...");
        }
      }
      const sbx = await Sandbox.create("base", { apiKey: this.apiKey });
      this.e2bSandboxId = sbx.sandboxId;
      return sbx;
    } catch (err: any) {
      console.error("[E2B Error]:", err.message);
      return null;
    }
  }

  public async runCommand(rawCmd: string): Promise<{ stdout: string; stderr: string; exitCode: number; mode: string }> {
    const cmd = cleanBlockContent(rawCmd);
    const sbx = await this.getSandboxInstance();
    if (sbx) {
      try {
        const result = await sbx.commands.run(cmd);
        return {
          stdout: result.stdout || "",
          stderr: result.stderr || "",
          exitCode: result.exitCode ?? 0,
          mode: `E2B VM (${sbx.sandboxId})`,
        };
      } catch (err: any) {
        return { stdout: "", stderr: err.message, exitCode: 1, mode: "E2B Error" };
      }
    }
    return { stdout: `[Virtual DO] Executed: ${cmd}`, stderr: "", exitCode: 0, mode: "Virtual DO" };
  }

  public async runPython(rawCode: string): Promise<{ stdout: string; stderr: string; exitCode: number; mode: string }> {
    const cleanPy = cleanBlockContent(rawCode);
    const b64 = btoa(unescape(encodeURIComponent(cleanPy)));
    const runScript = `mkdir -p /tmp && echo "${b64}" | base64 -d > /tmp/runner.py && python3 -u /tmp/runner.py 2>&1`;
    return await this.runCommand(runScript);
  }

  public async writeFile(rawPath: string, rawContent: string): Promise<void> {
    const p = cleanPath(rawPath);
    const content = cleanBlockContent(rawContent);

    if (p.includes("/")) {
      const parentDir = p.substring(0, p.lastIndexOf("/"));
      this.memoryFiles[parentDir] = { content: "", type: "directory" };
    }

    this.memoryFiles[p] = { content, type: "file" };

    const sbx = await this.getSandboxInstance();
    if (sbx) {
      try {
        if (p.includes("/")) {
          const parentDir = p.substring(0, p.lastIndexOf("/"));
          await sbx.commands.run(`mkdir -p "${parentDir}"`);
        }
        await sbx.files.write(p, content);
      } catch (err: any) {
        console.error(`[E2B Write Error ${p}]:`, err.message);
      }
    }
  }

  public async readFile(rawPath: string): Promise<string> {
    const p = cleanPath(rawPath);

    // 1. Direct hit in DO transactional memory
    if (this.memoryFiles[p]?.content) {
      return this.memoryFiles[p].content;
    }

    // 2. Directory overview
    if (this.memoryFiles[p]?.type === "directory") {
      const childFiles = Object.keys(this.memoryFiles).filter((k) => k.startsWith(p + "/") && k !== p);
      return `// Directory: ${p}\n// Contents:\n${childFiles.map((c) => `//  - ${c}`).join("\n") || "//  (Empty directory)"}`;
    }

    // 3. In-VM Disk Fallback
    const sbx = await this.getSandboxInstance();
    if (sbx) {
      try {
        const catRes = await this.runCommand(`cat "${p}"`);
        if (catRes.exitCode === 0 && catRes.stdout) {
          this.memoryFiles[p] = { content: catRes.stdout, type: "file" };
          return catRes.stdout;
        }
      } catch {}
    }

    return "";
  }

  public async getExplorerFileList(): Promise<FileItem[]> {
    const scanScript = `node -e '
      const fs = require("fs");
      const path = require("path");
      function scan(dir) {
        let results = [];
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.name.startsWith(".") && e.name !== ".env") continue;
            if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
            const fullRel = path.join(dir, e.name).replace(/^\\.\\/?/, "");
            if (e.isDirectory()) {
              results.push({ name: fullRel, path: fullRel, type: "directory" });
              results = results.concat(scan(path.join(dir, e.name)));
            } else {
              results.push({ name: fullRel, path: fullRel, type: "file" });
            }
          }
        } catch (err) {}
        return results;
      }
      console.log(JSON.stringify(scan(".")));
    '`;

    const res = await this.runCommand(scanScript);
    if (res.exitCode === 0 && res.stdout) {
      try {
        const items = JSON.parse(res.stdout.trim());
        for (const item of items) {
          if (!this.memoryFiles[item.path]) {
            this.memoryFiles[item.path] = { content: "", type: item.type };
          }
        }
        return items.filter((item: any) => !item.path.startsWith("it/") && item.path !== "it");
      } catch {}
    }

    return Object.entries(this.memoryFiles)
      .filter(([p]) => !p.startsWith("it/") && p !== "it")
      .map(([p, v]) => ({
        name: p,
        path: p,
        type: v.type || "file",
      }));
  }
}
