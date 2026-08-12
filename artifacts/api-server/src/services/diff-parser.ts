export interface SearchReplaceBlock {
  filePath: string;
  searchBlock: string;
  replaceBlock: string;
}

export interface DiffParseResult {
  filePath?: string;
  blocks: SearchReplaceBlock[];
  rawText: string;
}

export class DiffParserService {
  /**
   * Parses SEARCH/REPLACE blocks from LLM responses.
   * Format:
   *
   * path/to/file.ts
   * <<<<<<< SEARCH
   * const x = 1;
   * =======
   * const x = 2;
   * >>>>>>> REPLACE
   */
  public static parseSearchReplaceBlocks(llmResponse: string): DiffParseResult {
    const blocks: SearchReplaceBlock[] = [];
    const lines = llmResponse.split("\n");

    let currentFilePath = "";
    let inSearch = false;
    let inReplace = false;
    let currentSearchLines: string[] = [];
    let currentReplaceLines: string[] = [];

    const searchMarker = "<<<<<<< SEARCH";
    const dividerMarker = "=======";
    const replaceMarker = ">>>>>>> REPLACE";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Detect file path preceding search block (e.g. `src/index.ts` or `### src/index.ts`)
      if (
        !inSearch &&
        !inReplace &&
        trimmed.length > 0 &&
        !trimmed.startsWith("<") &&
        !trimmed.startsWith("=") &&
        !trimmed.startsWith(">")
      ) {
        // Strip markdown headers like `### ` or ``` filename
        const cleanPath = trimmed
          .replace(/^#+\s*/, "")
          .replace(/^```[a-z]*\s*/, "")
          .replace(/`/g, "")
          .trim();

        if (cleanPath.includes("/") || cleanPath.includes(".")) {
          currentFilePath = cleanPath;
        }
      }

      if (trimmed === searchMarker) {
        inSearch = true;
        inReplace = false;
        currentSearchLines = [];
        currentReplaceLines = [];
        continue;
      }

      if (trimmed === dividerMarker && inSearch) {
        inSearch = false;
        inReplace = true;
        continue;
      }

      if (trimmed === replaceMarker && inReplace) {
        inReplace = false;
        blocks.push({
          filePath: currentFilePath,
          searchBlock: currentSearchLines.join("\n"),
          replaceBlock: currentReplaceLines.join("\n"),
        });
        currentSearchLines = [];
        currentReplaceLines = [];
        continue;
      }

      if (inSearch) {
        currentSearchLines.push(line);
      } else if (inReplace) {
        currentReplaceLines.push(line);
      }
    }

    return {
      filePath: currentFilePath,
      blocks,
      rawText: llmResponse,
    };
  }
}