import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { assertSafePath, SandboxSecurityError } from "./security";
import { applySearchReplaceBlock } from "../diff-patch/search-replace";

const execPromisified = promisify(execCb);

export interface CommandExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class SandboxExecutor {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  private resolvePath(relPath: string): string {
    return assertSafePath(this.workspaceRoot, relPath);
  }

  async readFile(relPath: string, encoding: BufferEncoding = "utf-8"): Promise<string> {
    const fullPath = this.resolvePath(relPath);
    return await fs.readFile(fullPath, { encoding });
  }

  async writeFile(relPath: string, content: string): Promise<string> {
    const fullPath = this.resolvePath(relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
    return `Successfully wrote file: ${relPath}`;
  }

  async editFileDiff(
    relPath: string,
    searchBlock: string,
    replaceBlock: string
  ): Promise<{ success: boolean; output: string; error?: string }> {
    const fullPath = this.resolvePath(relPath);
    let original: string;
    try {
      original = await fs.readFile(fullPath, "utf-8");
    } catch (err: any) {
      return {
        success: false,
        output: "",
        error: `Could not read file '${relPath}': ${err.message || String(err)}`,
      };
    }

    const diffResult = applySearchReplaceBlock(original, searchBlock, replaceBlock, relPath);
    if (!diffResult.success || diffResult.newContent === undefined) {
      return {
        success: false,
        output: "",
        error: diffResult.error || "Failed to apply diff block.",
      };
    }

    await fs.writeFile(fullPath, diffResult.newContent, "utf-8");
    return {
      success: true,
      output: `Successfully edited file: ${relPath}`,
    };
  }

  async listDirectory(relPath: string = ".", recursive = false): Promise<string> {
    const fullPath = this.resolvePath(relPath);
    const stats = await fs.stat(fullPath);
    if (!stats.isDirectory()) {
      throw new SandboxSecurityError(`Provided path is not a directory: ${relPath}`);
    }

    async function walk(dir: string, prefix = ""): Promise<string[]> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const results: string[] = [];
      for (const entry of entries) {
        const relative = path.join(prefix, entry.name);
        results.push(relative + (entry.isDirectory() ? path.sep : ""));
        if (recursive && entry.isDirectory()) {
          const deeper = await walk(path.join(dir, entry.name), relative);
          results.push(...deeper);
        }
      }
      return results;
    }

    const listing = await walk(fullPath);
    return listing.join("\n");
  }

  async grepSearch(
    pattern: string,
    relPath: string = ".",
    includePattern?: string
  ): Promise<{ success: boolean; output: string; error?: string }> {
    const searchRoot = this.resolvePath(relPath);
    const escapedPattern = pattern.replace(/'/g, "'\\''");

    let cmd = `grep -rnI --exclude-dir=node_modules --exclude-dir=.git`;
    if (includePattern) {
      cmd += ` --include='${includePattern}'`;
    }
    cmd += ` '${escapedPattern}' .`;

    const result = await this.executeCommand(cmd, { cwd: relPath, timeoutMs: 30000 });
    return {
      success: result.exitCode === 0 || result.exitCode === 1,
      output: result.stdout || result.stderr || `No matches found for pattern '${pattern}'.`,
      error: result.exitCode > 1 ? result.stderr || `Grep failed with exit code ${result.exitCode}` : undefined,
    };
  }

  async executeCommand(
    command: string,
    options?: { cwd?: string; timeoutMs?: number }
  ): Promise<CommandExecutionResult> {
    const timeoutMs = options?.timeoutMs ?? 30000;
    const targetCwd = options?.cwd ? this.resolvePath(options.cwd) : this.workspaceRoot;

    // Validate command against dangerous patterns
    this.validateCommandSafety(command);

    // Sanitize process environment
    const safeEnv: Record<string, string> = {};
    const allowedEnvKeys = [
      "PATH",
      "HOME",
      "USER",
      "LANG",
      "LC_ALL",
      "NODE_ENV",
      "TERM",
      "TMPDIR",
    ];
    for (const key of allowedEnvKeys) {
      if (process.env[key]) {
        safeEnv[key] = process.env[key]!;
      }
    }
    safeEnv.PATH = safeEnv.PATH || "/usr/local/bin:/usr/bin:/bin";

    try {
      const res = await execPromisified(command, {
        cwd: targetCwd,
        timeout: timeoutMs,
        maxBuffer: 5 * 1024 * 1024, // 5MB buffer limit
        env: safeEnv,
      });

      return {
        stdout: res.stdout.trim(),
        stderr: res.stderr.trim(),
        exitCode: 0,
      };
    } catch (err: any) {
      return {
        stdout: (err.stdout || "").trim(),
        stderr: (err.stderr || err.message || "").trim(),
        exitCode: typeof err.code === "number" ? err.code : 1,
      };
    }
  }

  private validateCommandSafety(command: string): void {
    if (!command || typeof command !== "string") return;
    const cmd = command.trim();
    const dangerousPatterns = [
      /rm\s+-[rRfF]*\s+[\/*]/i,
      /\bmkfs\b/i,
      /\bsudo\b/i,
      /\bdd\s+if=/i,
      /\bshutdown\b/i,
      /\breboot\b/i,
      /:(){ :|:& };:/,
      />\s*\/dev\/sd[a-z]/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(cmd)) {
        throw new SandboxSecurityError(`Command blocked by sandbox security policy: '${command}'`);
      }
    }
  }
}
