import * as ts from "typescript";

export interface SymbolLocation {
  line: number;
  character: number;
}

export interface CodeSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "method" | "variable" | "export";
  signature: string;
  location: SymbolLocation;
  docstring?: string;
}

export interface ASTParseResult {
  filePath: string;
  imports: string[];
  exports: CodeSymbol[];
  symbols: CodeSymbol[];
}

export class ASTParserService {
  /**
   * Parse TypeScript/JavaScript files using the TypeScript Compiler AST Engine.
   */
  public static parseTypeScript(filePath: string, code: string): ASTParseResult {
    const sourceFile = ts.createSourceFile(
      filePath,
      code,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith(".tsx") || filePath.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    const imports: string[] = [];
    const symbols: CodeSymbol[] = [];
    const exports: CodeSymbol[] = [];

    const visit = (node: ts.Node) => {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile)
      );

      // Extract Import Statements
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier.getText(sourceFile).replace(/['"]/g, "");
        imports.push(moduleSpecifier);
      }

      // Extract Functions
      if (ts.isFunctionDeclaration(node) && node.name) {
        const isExported = !!(
          ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export
        );
        const name = node.name.text;
        const params = node.parameters
          .map((p) => p.getText(sourceFile))
          .join(", ");
        const returnType = node.type ? `: ${node.type.getText(sourceFile)}` : "";
        const signature = `function ${name}(${params})${returnType}`;

        const sym: CodeSymbol = {
          name,
          kind: "function",
          signature,
          location: { line: line + 1, character: character + 1 },
        };

        symbols.push(sym);
        if (isExported) exports.push(sym);
      }

      // Extract Classes & Class Methods
      if (ts.isClassDeclaration(node) && node.name) {
        const isExported = !!(
          ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export
        );
        const className = node.name.text;
        const sym: CodeSymbol = {
          name: className,
          kind: "class",
          signature: `class ${className}`,
          location: { line: line + 1, character: character + 1 },
        };

        symbols.push(sym);
        if (isExported) exports.push(sym);

        // Visit class members for methods
        node.members.forEach((member) => {
          if (ts.isMethodDeclaration(member) && member.name) {
            const methodName = member.name.getText(sourceFile);
            const mLine = sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile));
            const params = member.parameters.map((p) => p.getText(sourceFile)).join(", ");
            const ret = member.type ? `: ${member.type.getText(sourceFile)}` : "";

            symbols.push({
              name: `${className}.${methodName}`,
              kind: "method",
              signature: `${methodName}(${params})${ret}`,
              location: { line: mLine.line + 1, character: mLine.character + 1 },
            });
          }
        });
      }

      // Extract Interfaces & Type Aliases
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        const isExported = !!(
          ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export
        );
        const name = node.name.text;
        const kind = ts.isInterfaceDeclaration(node) ? "interface" : "type";
        const sym: CodeSymbol = {
          name,
          kind,
          signature: `${kind} ${name}`,
          location: { line: line + 1, character: character + 1 },
        };

        symbols.push(sym);
        if (isExported) exports.push(sym);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return { filePath, imports, exports, symbols };
  }

  /**
   * Fallback regex symbol extractor for Python, Go, Rust, and generic languages.
   */
  public static parseGeneric(filePath: string, code: string): ASTParseResult {
    const lines = code.split("\n");
    const symbols: CodeSymbol[] = [];
    const imports: string[] = [];

    const funcRegex = /(?:def|func|fn)\s+([a-zA-Z0-9_]+)\s*\(/;
    const classRegex = /(?:class|struct)\s+([a-zA-Z0-9_]+)/;

    lines.forEach((lineText, idx) => {
      let match = lineText.match(funcRegex);
      if (match) {
        symbols.push({
          name: match[1],
          kind: "function",
          signature: lineText.trim(),
          location: { line: idx + 1, character: 1 },
        });
      }

      match = lineText.match(classRegex);
      if (match) {
        symbols.push({
          name: match[1],
          kind: "class",
          signature: lineText.trim(),
          location: { line: idx + 1, character: 1 },
        });
      }
    });

    return { filePath, imports, exports: symbols, symbols };
  }
}