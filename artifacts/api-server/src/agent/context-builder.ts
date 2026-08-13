import * as fs from "fs/promises";
import * as path from "path";

export interface RepoSymbolMap {
  files: {
    path: string;
    exports: string[];
    imports: string[];
  }[];
}

export class ContextBuilder {
  /**
   * Scans a directory and builds a compressed signature map
   */
  static async buildRepoContext(rootDir: string): Promise<string> {
    const symbols: string[] = [];

    async function scan(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!["node_modules", ".git", "dist", "build", ".next"].includes(entry.name)) {
            await scan(fullPath);
          }
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          const content = await fs.readFile(fullPath, "utf-8");
          const relativePath = path.relative(rootDir, fullPath);
          const signatures = ContextBuilder.extractSignatures(content);
          if (signatures.length > 0) {
            symbols.push(`// --- ${relativePath} ---\n${signatures.join("\n")}`);
          }
        }
      }
    }

    try {
      await scan(rootDir);
    } catch {
      return "// Codebase context unavailable";
    }

    return symbols.join("\n\n");
  }

  private static extractSignatures(content: string): string[] {
    const lines = content.split("\n");
    const signatures: string[] = [];
    const exportRegex = /^export\s+(type|interface|class|function|const|enum)\s+([A-Za-z0-9_]+)/;

    for (const line of lines) {
      const trimmed = line.trim();
      if (exportRegex.test(trimmed)) {
        signatures.push(trimmed.slice(0, 100)); // Cap length per line
      }
    }
    return signatures;
  }
}