import { ASTParserService, ASTParseResult } from "./ast-parser";

export interface FileEntry {
  filePath: string;
  content: string;
}

export class RepoMapService {
  /**
   * Generates a high-level AST skeleton map of the repository.
   * Format:
   * src/utils/auth.ts:
   *   │ export function verifyToken(token: string): Payload
   *   │ export class AuthError
   */
  public static generateRepoMap(
    files: FileEntry[],
    maxTokenBudget: number = 2000
  ): string {
    let mapOutput = "### REPOSITORY MAP & AST SKELETON\n\n";

    for (const file of files) {
      if (
        file.filePath.includes("node_modules") ||
        file.filePath.includes(".git") ||
        file.filePath.endsWith(".map")
      ) {
        continue;
      }

      let parsed: ASTParseResult;
      if (file.filePath.match(/\.(ts|tsx|js|jsx)$/)) {
        parsed = ASTParserService.parseTypeScript(file.filePath, file.content);
      } else {
        parsed = ASTParserService.parseGeneric(file.filePath, file.content);
      }

      if (parsed.exports.length === 0 && parsed.symbols.length === 0) {
        mapOutput += `${file.filePath}\n`;
        continue;
      }

      mapOutput += `${file.filePath}:\n`;

      // Show exports first
      const displaySymbols =
        parsed.exports.length > 0 ? parsed.exports : parsed.symbols.slice(0, 8);

      for (const sym of displaySymbols) {
        mapOutput += `  │ ${sym.signature} (line ${sym.location.line})\n`;
      }
      mapOutput += "\n";

      // Truncate if token budget estimate exceeded (~4 chars per token)
      if (mapOutput.length > maxTokenBudget * 4) {
        mapOutput += "... [Repo Map truncated to fit context budget]\n";
        break;
      }
    }

    return mapOutput;
  }
}