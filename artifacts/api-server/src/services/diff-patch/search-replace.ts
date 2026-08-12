import fs from "node:fs/promises";
import path from "node:path";

export interface SearchReplaceBlock {
  search: string;
  replace: string;
}

export interface PatchResult {
  success: boolean;
  filePath: string;
  modifiedContent?: string;
  error?: string;
}

export class SearchReplaceEngine {
  /**
   * Applies one or more search/replace blocks to a targeted file.
   */
  static async applyPatch(
    filePath: string,
    blocks: SearchReplaceBlock[]
  ): Promise<PatchResult> {
    try {
      const absolutePath = path.resolve(filePath);
      const originalContent = await fs.readFile(absolutePath, "utf-8");
      let currentContent = originalContent;

      for (let i = 0; i < blocks.length; i++) {
        const { search, replace } = blocks[i];
        const normalizedSearch = this.normalizeLineEndings(search);
        const normalizedContent = this.normalizeLineEndings(currentContent);

        if (!normalizedContent.includes(normalizedSearch)) {
          // Attempt fuzzy trim match as fallback
          const trimmedSearch = normalizedSearch.trim();
          if (normalizedContent.includes(trimmedSearch)) {
            currentContent = normalizedContent.replace(trimmedSearch, this.normalizeLineEndings(replace));
            continue;
          }

          return {
            success: false,
            filePath,
            error: `Block ${i + 1} match failed: The specified search block was not found in ${filePath}.`,
          };
        }

        currentContent = normalizedContent.replace(
          normalizedSearch,
          this.normalizeLineEndings(replace)
        );
      }

      await fs.writeFile(absolutePath, currentContent, "utf-8");

      return {
        success: true,
        filePath,
        modifiedContent: currentContent,
      };
    } catch (err: any) {
      return {
        success: false,
        filePath,
        error: `Failed to patch file ${filePath}: ${err.message}`,
      };
    }
  }

  private static normalizeLineEndings(str: string): string {
    return str.replace(/\r\n/g, "\n");
  }
}