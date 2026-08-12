import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";
import { ToolRegistry, globalToolRegistry } from "./tools/registry";
import { ReActMessage } from "./react-loop";

const WORKSPACE_ROOT = path.resolve(process.cwd());

function resolveWorkspacePath(relativePath: string): string {
  const resolved = path.resolve(WORKSPACE_ROOT, relativePath);
  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    throw new Error(`Security Violation: Path '${relativePath}' attempts to traverse outside workspace root.`);
  }
  return resolved;
}

// Default directory ignore patterns for indexer
const IGNORE_PATTERNS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
]);

// ==========================================
// 1. Workspace Tree Indexer
// ==========================================

export class WorkspaceIndexer {
  private workspaceRoot: string;

  constructor(workspaceRoot: string = WORKSPACE_ROOT) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Recursively build visual workspace tree string up to maxDepth.
   */
  async buildDirectoryTree(
    relativeSubdir: string = ".",
    maxDepth: number = 3,
    currentDepth: number = 0
  ): Promise<string> {
    const targetDir = resolveWorkspacePath(relativeSubdir);
    
    if (currentDepth >= maxDepth) {
      return "... (max depth reached)";
    }

    let entries;
    try {
      entries = await fs.readdir(targetDir, { withFileTypes: true });
    } catch (err: any) {
      return `[Error reading directory: ${err.message}]`;
    }

    const lines: string[] = [];
    const filtered = entries.filter((e) => !IGNORE_PATTERNS.has(e.name) && !e.name.startsWith("."));

    // Sort directories first, then files
    filtered.sort((a, b) => {
      if (a.isDirectory() === b.isDirectory()) return a.name.localeCompare(b.name);
      return a.isDirectory() ? -1 : 1;
    });

    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i];
      const isLast = i === filtered.length - 1;
      const prefix = "│   ".repeat(currentDepth) + (isLast ? "└── " : "├── ");

      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        const subRelPath = path.relative(this.workspaceRoot, path.join(targetDir, entry.name));
        const subTree = await this.buildDirectoryTree(subRelPath, maxDepth, currentDepth + 1);
        if (subTree && !subTree.startsWith("...")) {
          lines.push(subTree);
        }
      } else {
        lines.push(`${prefix}${entry.name}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * AST/Regex symbol extractor for TypeScript / JavaScript files.
   * Extracts exported functions, classes, interfaces, types, and variables.
   */
  async extractSymbols(relativePath: string): Promise<string> {
    const targetPath = resolveWorkspacePath(relativePath);
    const content = await fs.readFile(targetPath, "utf-8");

    const lines = content.split("\n");
    const symbols: string[] = [];

    // Regex match patterns for JS/TS exports and definitions
    const symbolRegex = /^\s*(export\s+(default\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var)\s+([A-Za-z0-9_]+))/;

    lines.forEach((line, index) => {
      const match = line.match(symbolRegex);
      if (match) {
        symbols.push(`Line ${index + 1}: ${line.trim()}`);
      }
    });

    if (symbols.length === 0) {
      return `No top-level exported AST symbols found in '${relativePath}'.`;
    }

    return `Extracted Symbol Outline for '${relativePath}':\n` + symbols.join("\n");
  }
}

// ==========================================
// 2. Session Diff Tracker
// ==========================================

export interface FileSnapshot {
  originalPath: string;
  originalContent: string;
  modifiedContent?: string;
}

export class SessionDiffTracker {
  private snapshots: Map<string, FileSnapshot> = new Map();

  /**
   * Capture initial file content before modification if not already captured.
   */
  async trackOriginal(relativePath: string): Promise<void> {
    if (this.snapshots.has(relativePath)) return;
    try {
      const targetPath = resolveWorkspacePath(relativePath);
      const originalContent = await fs.readFile(targetPath, "utf-8");
      this.snapshots.set(relativePath, { originalPath: relativePath, originalContent });
    } catch {
      // New file creation case
      this.snapshots.set(relativePath, { originalPath: relativePath, originalContent: "" });
    }
  }

  /**
   * Record updated content for file.
   */
  recordModification(relativePath: string, newContent: string): void {
    const existing = this.snapshots.get(relativePath);
    if (existing) {
      existing.modifiedContent = newContent;
    } else {
      this.snapshots.set(relativePath, {
        originalPath: relativePath,
        originalContent: "",
        modifiedContent: newContent,
      });
    }
  }

  /**
   * Generate unified diff format for line changes.
   */
  generateUnifiedDiff(filePath: string): string {
    const snapshot = this.snapshots.get(filePath);
    if (!snapshot || snapshot.modifiedContent === undefined) {
      return `No modifications recorded for '${filePath}'.`;
    }

    const origLines = snapshot.originalContent.split("\n");
    const modLines = snapshot.modifiedContent.split("\n");

    const diffLines: string[] = [
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
      `@@ session modification diff @@`,
    ];

    let changesCount = 0;
    const maxLen = Math.max(origLines.length, modLines.length);

    for (let i = 0; i < maxLen; i++) {
      const orig = origLines[i];
      const mod = modLines[i];

      if (orig !== mod) {
        if (orig !== undefined) {
          diffLines.push(`- ${orig}`);
          changesCount++;
        }
        if (mod !== undefined) {
          diffLines.push(`+ ${mod}`);
          changesCount++;
        }
      } else if (orig !== undefined) {
        // Include context lines around changes
        if (i > 0 && origLines[i - 1] !== modLines[i - 1]) {
          diffLines.push(`  ${orig}`);
        }
      }
    }

    if (changesCount === 0) {
      return `File '${filePath}' matches original content (no diff).`;
    }

    return diffLines.join("\n");
  }

  /**
   * Generate full summary of session changes across all modified files.
   */
  getOverallSessionDiff(): string {
    const diffs: string[] = [];
    for (const [filePath] of this.snapshots) {
      const diff = this.generateUnifiedDiff(filePath);
      if (!diff.includes("no diff")) {
        diffs.push(diff);
      }
    }

    if (diffs.length === 0) {
      return "No file modifications recorded in current agent session.";
    }

    return diffs.join("\n\n");
  }
}

// Global diff tracker instance for session state
export const globalDiffTracker = new SessionDiffTracker();

// ==========================================
// 3. Context Window Token Budget Manager
// ==========================================

export class TokenBudgetManager {
  private maxTokenBudget: number;

  constructor(maxTokenBudget: number = 16000) {
    this.maxTokenBudget = maxTokenBudget;
  }

  /**
   * Fast token count estimator (~4 characters per token average).
   */
  estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate tokens across standard message arrays.
   */
  estimateMessagesTokens(messages: ReActMessage[]): number {
    return messages.reduce((acc, msg) => {
      const contentTokens = this.estimateTokens(msg.content || "");
      const toolCallTokens = msg.tool_calls
        ? this.estimateTokens(JSON.stringify(msg.tool_calls))
        : 0;
      return acc + contentTokens + toolCallTokens + 4;
    }, 0);
  }

  /**
   * Truncate/prune older tool message results when approaching token limits.
   * Keeps system prompt and recent turns intact.
   */
  pruneMessages(messages: ReActMessage[]): ReActMessage[] {
    const currentTotal = this.estimateMessagesTokens(messages);
    if (currentTotal <= this.maxTokenBudget) {
      return messages;
    }

    const pruned = [...messages];
    let tokenCount = currentTotal;

    // Iterate through older messages starting after system prompt (index 1) up to recent history
    for (let i = 1; i < pruned.length - 2; i++) {
      const msg = pruned[i];
      if (msg.role === "tool" && msg.content && msg.content.length > 300) {
        const originalTokens = this.estimateTokens(msg.content);
        const truncatedContent = msg.content.slice(0, 200) + "\n... [Output truncated to preserve token budget]";
        const newTokens = this.estimateTokens(truncatedContent);

        pruned[i] = { ...msg, content: truncatedContent };
        tokenCount -= originalTokens - newTokens;

        if (tokenCount <= this.maxTokenBudget) {
          break;
        }
      }
    }

    return pruned;
  }
}

// ==========================================
// 4. Register Indexer & Diff Tools
// ==========================================

export function initializeContextTools(registry: ToolRegistry = globalToolRegistry) {
  const indexer = new WorkspaceIndexer();

  // 1. Tool: Get Workspace Visual Tree
  registry.registerTool({
    name: "get_workspace_tree",
    description: "Get a visual directory tree structure of the repository.",
    parameters: z.object({
      pathPrefix: z.string().optional().describe("Subdirectory path (defaults to workspace root '.')."),
      maxDepth: z.number().optional().describe("Max directory recursion depth (default 3)."),
    }),
    execute: async (args) => {
      const tree = await indexer.buildDirectoryTree(args.pathPrefix || ".", args.maxDepth || 3);
      return {
        success: true,
        output: `Workspace Tree (${args.pathPrefix || "root"}):\n${tree}`,
      };
    },
  });

  // 2. Tool: Get AST File Symbols
  registry.registerTool({
    name: "get_file_symbols",
    description: "Extract exported function signatures, classes, interfaces, and types from a file.",
    parameters: z.object({
      path: z.string().describe("Relative filepath to parse AST symbols from."),
    }),
    execute: async (args) => {
      try {
        const outline = await indexer.extractSymbols(args.path);
        return {
          success: true,
          output: outline,
        };
      } catch (err: any) {
        return {
          success: false,
          output: `Failed to extract symbols from '${args.path}': ${err.message}`,
        };
      }
    },
  });

  // 3. Tool: Get Session Unified Diff
  registry.registerTool({
    name: "get_session_diff",
    description: "Get unified diffs for modified files in the active session.",
    parameters: z.object({
      filePath: z.string().optional().describe("Optional single file path. If omitted, returns diff for all modified files."),
    }),
    execute: async (args) => {
      if (args.filePath) {
        const diff = globalDiffTracker.generateUnifiedDiff(args.filePath);
        return { success: true, output: diff };
      }
      const overallDiff = globalDiffTracker.getOverallSessionDiff();
      return { success: true, output: overallDiff };
    },
  });
}

// Register tools on import
initializeContextTools();