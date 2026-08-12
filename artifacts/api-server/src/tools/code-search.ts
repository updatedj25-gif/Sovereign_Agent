import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { globalToolRegistry } from "../agent/tools/registry";

export interface SearchMatch {
  filePath: string;
  lineNumber: number;
  columnNumber?: number;
  lineContent: string;
}

export interface SymbolDefinition {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "const" | "export";
  filePath: string;
  lineNumber: number;
  snippet: string;
}

export interface CodeSearchOptions {
  query: string;
  cwd?: string;
  fileExtensions?: string[];
  maxResults?: number;
  caseSensitive?: boolean;
}

/**
 * Fast workspace search engine with Ripgrep (`rg`) integration and Node filesystem fallback.
 */
export async function searchCodebase(options: CodeSearchOptions): Promise<SearchMatch[]> {
  const { query, cwd = process.cwd(), fileExtensions, maxResults = 50, caseSensitive = false } = options;

  // Try Ripgrep native binary first for high performance
  const rgMatches = await tryRipgrepSearch(query, cwd, {
    fileExtensions,
    maxResults,
    caseSensitive,
  });

  if (rgMatches !== null) {
    return rgMatches;
  }

  // Fallback to recursive Node.js filesystem search
  return fallbackNodeSearch(query, cwd, {
    fileExtensions,
    maxResults,
    caseSensitive,
  });
}

/**
 * Execute Ripgrep binary if available on system PATH.
 */
function tryRipgrepSearch(
  query: string,
  cwd: string,
  opts: { fileExtensions?: string[]; maxResults: number; caseSensitive: boolean }
): Promise<SearchMatch[] | null> {
  return new Promise((resolve) => {
    const args = ["--line-number", "--column", "--no-heading", "--color=never"];

    if (!opts.caseSensitive) args.push("-i");
    if (opts.fileExtensions) {
      opts.fileExtensions.forEach((ext) => args.push("-g", `*.${ext.replace(/^\./, "")}`));
    }

    args.push("-m", String(opts.maxResults));
    args.push(query, ".");

    let stdout = "";
    let isError = false;

    const child = spawn("rg", args, { cwd, shell: true });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });

    child.on("error", () => {
      isError = true;
      resolve(null); // Fallback to Node filesystem search
    });

    child.on("close", (code) => {
      if (isError || (code !== 0 && code !== 1)) {
        return resolve(null);
      }

      const matches: SearchMatch[] = [];
      const lines = stdout.split("\n").filter(Boolean);

      for (const line of lines) {
        // Ripgrep format: filepath:line:col:content
        const parts = line.split(":");
        if (parts.length >= 4) {
          const filePath = parts[0];
          const lineNumber = parseInt(parts[1], 10);
          const columnNumber = parseInt(parts[2], 10);
          const lineContent = parts.slice(3).join(":").trim();

          matches.push({ filePath, lineNumber, columnNumber, lineContent });
        }
      }

      resolve(matches);
    });
  });
}

/**
 * Recursive Node.js filesystem scanner as a portable fallback.
 */
async function fallbackNodeSearch(
  query: string,
  rootPath: string,
  opts: { fileExtensions?: string[]; maxResults: number; caseSensitive: boolean }
): Promise<SearchMatch[]> {
  const matches: SearchMatch[] = [];
  const searchRegex = new RegExp(query, opts.caseSensitive ? "g" : "gi");

  function scanDir(dir: string) {
    if (matches.length >= opts.maxResults) return;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (matches.length >= opts.maxResults) break;

      const fullPath = path.join(dir, entry.name);
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }

      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).replace(/^\./, "");
        if (opts.fileExtensions && opts.fileExtensions.length > 0 && !opts.fileExtensions.includes(ext)) {
          continue;
        }

        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            if (searchRegex.test(lines[i])) {
              const relPath = path.relative(rootPath, fullPath);
              matches.push({
                filePath: relPath,
                lineNumber: i + 1,
                lineContent: lines[i].trim(),
              });
              if (matches.length >= opts.maxResults) break;
            }
            searchRegex.lastIndex = 0;
          }
        } catch {
          // Ignore binary/unreadable files
        }
      }
    }
  }

  scanDir(rootPath);
  return matches;
}

/**
 * Extract exported symbols (functions, classes, interfaces) from a workspace file.
 */
export function extractSymbolsFromCode(code: string, filePath: string): SymbolDefinition[] {
  const symbols: SymbolDefinition[] = [];
  const lines = code.split("\n");

  const symbolRegexes = [
    { kind: "function" as const, regex: /export\s+(async\s+)?function\s+([A-Za-z0-9_]+)/ },
    { kind: "class" as const, regex: /export\s+class\s+([A-Za-z0-9_]+)/ },
    { kind: "interface" as const, regex: /export\s+interface\s+([A-Za-z0-9_]+)/ },
    { kind: "type" as const, regex: /export\s+type\s+([A-Za-z0-9_]+)/ },
    { kind: "const" as const, regex: /export\s+const\s+([A-Za-z0-9_]+)/ },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { kind, regex } of symbolRegexes) {
      const match = line.match(regex);
      if (match) {
        symbols.push({
          name: match[2],
          kind,
          filePath,
          lineNumber: i + 1,
          snippet: line.trim(),
        });
      }
    }
  }

  return symbols;
}

// ==========================================
// Register Code Search Tools
// ==========================================

globalToolRegistry.registerTool({
  name: "search_codebase",
  description:
    "Fast regex and keyword codebase search using Ripgrep indexer with line and column references.",
  parameters: z.object({
    query: z.string().describe("Search string or pattern."),
    fileExtensions: z
      .array(z.string())
      .optional()
      .describe("Optional filter by file extensions (e.g. ['ts', 'tsx'])."),
    maxResults: z.number().optional().describe("Maximum search matches (default: 30)."),
  }),
  execute: async (args) => {
    const matches = await searchCodebase({
      query: args.query,
      fileExtensions: args.fileExtensions,
      maxResults: args.maxResults || 30,
    });

    if (matches.length === 0) {
      return {
        success: true,
        output: `No search matches found for '${args.query}'.`,
        data: { matchesCount: 0 },
      };
    }

    const outputLog = matches
      .map((m) => `${m.filePath}:${m.lineNumber}:${m.columnNumber || 1} -> ${m.lineContent}`)
      .join("\n");

    return {
      success: true,
      output: `Found ${matches.length} search matches:\n\n${outputLog}`,
      data: { matchesCount: matches.length, matches },
    };
  },
});