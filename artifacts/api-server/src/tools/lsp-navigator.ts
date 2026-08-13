import * as fs from "fs/promises";
import * as path from "path";
import * as ts from "typescript";
import { z } from "zod";
import { globalToolRegistry, ToolExecutionResult, ToolExecutionContext } from "../agent/registry";

export interface SymbolReference {
  filePath: string;
  line: number;
  column: number;
  lineContent: string;
  isDefinition?: boolean;
}

const WORKSPACE_ROOT = path.resolve(process.cwd());

/**
 * Scan workspace TypeScript/JavaScript files for references to a target symbol
 */
export async function findSymbolReferences(
  symbolName: string,
  targetFilePath?: string
): Promise<SymbolReference[]> {
  const references: SymbolReference[] = [];
  const symbolRegex = new RegExp(`\\b${escapeRegExp(symbolName)}\\b`, "g");

  async function scanDirectory(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (
        entry.name.startsWith(".") ||
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "build"
      ) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await scanDirectory(fullPath);
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/i.test(entry.name)) {
        if (targetFilePath && path.resolve(WORKSPACE_ROOT, targetFilePath) !== fullPath) {
          continue;
        }

        try {
          const content = await fs.readFile(fullPath, "utf-8");
          const lines = content.split("\n");

          lines.forEach((lineText, idx) => {
            if (symbolRegex.test(lineText)) {
              const col = lineText.indexOf(symbolName) + 1;
              const isDef = /export\s+(async\s+)?(function|class|interface|type|const|let)\s+/i.test(lineText);

              references.push({
                filePath: path.relative(WORKSPACE_ROOT, fullPath),
                line: idx + 1,
                column: col,
                lineContent: lineText.trim(),
                isDefinition: isDef,
              });
            }
            symbolRegex.lastIndex = 0;
          });
        } catch {
          /* skip unreadable files */
        }
      }
    }
  }

  await scanDirectory(WORKSPACE_ROOT);
  return references;
}

/**
 * Safely rename a symbol across all workspace files
 */
export async function renameSymbolAcrossWorkspace(
  oldName: string,
  newName: string
): Promise<{ modifiedFiles: string[]; totalReplacements: number }> {
  const references = await findSymbolReferences(oldName);

  if (references.length === 0) {
    throw new Error(`Symbol '${oldName}' was not found in the workspace.`);
  }

  const filesMap = new Map<string, string>();
  const modifiedFiles: string[] = [];
  let totalReplacements = 0;

  const replaceRegex = new RegExp(`\\b${escapeRegExp(oldName)}\\b`, "g");

  // Group references by file path
  const filePaths = Array.from(new Set(references.map((r) => r.filePath)));

  for (const relPath of filePaths) {
    const fullPath = path.resolve(WORKSPACE_ROOT, relPath);
    const content = await fs.readFile(fullPath, "utf-8");

    const matchesCount = (content.match(replaceRegex) || []).length;
    if (matchesCount > 0) {
      const updatedContent = content.replace(replaceRegex, newName);
      await fs.writeFile(fullPath, updatedContent, "utf-8");
      modifiedFiles.push(relPath);
      totalReplacements += matchesCount;
    }
  }

  return { modifiedFiles, totalReplacements };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ==========================================
// Register LSP Navigation Tools
// ==========================================

globalToolRegistry.registerTool({
  name: "find_references",
  description:
    "Locate all locations where a function, class, component, interface, or variable symbol is imported or used across the workspace.",
  parameters: z.object({
    symbolName: z.string().describe("Exact identifier or symbol name to search for (e.g. 'TaskGroup', 'executeCommand')."),
    filePath: z.string().optional().describe("Optional single file path to narrow reference search."),
  }),
  execute: async (args, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    try {
      context.emitEvent?.({
        type: "find_references_started",
        symbolName: args.symbolName,
      });

      const refs = await findSymbolReferences(args.symbolName, args.filePath);

      if (refs.length === 0) {
        return {
          success: true,
          output: `No references found for symbol '${args.symbolName}'.`,
          data: { referencesCount: 0 },
        };
      }

      const formatted = refs
        .map(
          (r) =>
            `- ${r.filePath}:${r.line}:${r.column} ${r.isDefinition ? "[DEF]" : "[USE]"} -> ${r.lineContent}`
        )
        .join("\n");

      return {
        success: true,
        output: `Found ${refs.length} reference(s) for '${args.symbolName}':\n\n${formatted}`,
        data: { referencesCount: refs.length, references: refs },
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Find References Failed: ${err.message}`,
        error: "FIND_REFERENCES_FAILED",
      };
    }
  },
});

globalToolRegistry.registerTool({
  name: "rename_symbol",
  description:
    "Safely rename a symbol across all workspace files, updating exports, imports, and usage call sites.",
  requiresApproval: true,
  parameters: z.object({
    oldName: z.string().describe("Existing symbol identifier to rename."),
    newName: z.string().describe("New replacement symbol identifier."),
  }),
  execute: async (args, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    try {
      context.emitEvent?.({
        type: "rename_symbol_started",
        oldName: args.oldName,
        newName: args.newName,
      });

      const res = await renameSymbolAcrossWorkspace(args.oldName, args.newName);

      const fileList = res.modifiedFiles.map((f) => `  - ${f}`).join("\n");

      return {
        success: true,
        output: `Successfully renamed '${args.oldName}' → '${args.newName}' across ${res.modifiedFiles.length} file(s) (${res.totalReplacements} replacements):\n\n${fileList}`,
        data: res,
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Rename Symbol Error: ${err.message}`,
        error: "RENAME_SYMBOL_FAILED",
      };
    }
  },
});