import * as ts from "typescript";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { globalToolRegistry } from "../agent/tools/registry";

export interface ASTSymbolNode {
  name: string;
  kind: string;
  line: number;
  column: number;
  parameters?: string[];
  returnType?: string;
  exported: boolean;
  documentation?: string;
}

/**
 * AST Symbol Navigation Helper
 * Inspects structural code semantics (functions, interfaces, classes, imports, exports) via TS Compiler API.
 */
export function parseAstSymbols(sourceCode: string, fileName: string): ASTSymbolNode[] {
  const scriptTarget = ts.ScriptTarget.Latest;
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceCode,
    scriptTarget,
    true,
    fileName.endsWith(".tsx") || fileName.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const symbols: ASTSymbolNode[] = [];

  function visit(node: ts.Node) {
    // 1. Function Declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const isExported = hasExportModifier(node);

      symbols.push({
        name: node.name.text,
        kind: "Function",
        line: line + 1,
        column: character + 1,
        parameters: node.parameters.map((p) => p.name.getText(sourceFile)),
        returnType: node.type ? node.type.getText(sourceFile) : "void/inferred",
        exported: isExported,
      });
    }

    // 2. Class Declarations
    else if (ts.isClassDeclaration(node) && node.name) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      symbols.push({
        name: node.name.text,
        kind: "Class",
        line: line + 1,
        column: character + 1,
        exported: hasExportModifier(node),
      });
    }

    // 3. Interface Declarations
    else if (ts.isInterfaceDeclaration(node)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      symbols.push({
        name: node.name.text,
        kind: "Interface",
        line: line + 1,
        column: character + 1,
        exported: hasExportModifier(node),
      });
    }

    // 4. Type Alias Declarations
    else if (ts.isTypeAliasDeclaration(node)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      symbols.push({
        name: node.name.text,
        kind: "TypeAlias",
        line: line + 1,
        column: character + 1,
        exported: hasExportModifier(node),
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return symbols;
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    !!node.modifiers &&
    node.modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

// ==========================================
// Register AST Query Tool
// ==========================================

globalToolRegistry.registerTool({
  name: "query_ast_symbols",
  description:
    "Extract structural AST symbol definitions (classes, functions, interfaces, type aliases) from a file.",
  parameters: z.object({
    filePath: z.string().describe("Target file path relative to workspace root."),
  }),
  execute: async (args) => {
    const absolutePath = path.resolve(args.filePath);

    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        output: `File not found at path: ${args.filePath}`,
        error: "FILE_NOT_FOUND",
      };
    }

    try {
      const content = fs.readFileSync(absolutePath, "utf-8");
      const symbols = parseAstSymbols(content, args.filePath);

      if (symbols.length === 0) {
        return {
          success: true,
          output: `No top-level AST symbols found in ${args.filePath}`,
          data: { symbols: [] },
        };
      }

      const formatted = symbols
        .map(
          (s) =>
            `- [${s.kind}] ${s.name}${s.parameters ? `(${s.parameters.join(", ")})` : ""} on Line ${s.line} ${
              s.exported ? "(exported)" : ""
            }`
        )
        .join("\n");

      return {
        success: true,
        output: `AST Symbols in ${args.filePath}:\n\n${formatted}`,
        data: { symbolsCount: symbols.length, symbols },
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Failed to parse AST symbols: ${err.message}`,
        error: "AST_PARSING_FAILED",
      };
    }
  },
});