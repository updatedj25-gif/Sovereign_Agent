import * as diff from "diff";

export interface PatchResult {
  success: boolean;
  newContent?: string;
  error?: string;
}

export class DiffEngine {
  /**
   * Applies an exact or fuzzy search-and-replace block on a file's content
   */
  static applySearchReplace(
    originalContent: string,
    searchBlock: string,
    replaceBlock: string
  ): PatchResult {
    // 1. Try exact match
    if (originalContent.includes(searchBlock)) {
      const newContent = originalContent.replace(searchBlock, replaceBlock);
      return { success: true, newContent };
    }

    // 2. Try normalized line-ending and whitespace match
    const normalize = (str: string) => str.replace(/\r\n/g, "\n").trim();
    const normalizedOriginal = originalContent.replace(/\r\n/g, "\n");
    const normalizedSearch = normalize(searchBlock);

    if (normalizedOriginal.includes(normalizedSearch)) {
      const newContent = normalizedOriginal.replace(
        normalizedSearch,
        replaceBlock.replace(/\r\n/g, "\n")
      );
      return { success: true, newContent };
    }

    // 3. Fallback: Unified patch calculation
    const patches = diff.structuredPatch(
      "file",
      "file",
      searchBlock,
      replaceBlock,
      "",
      ""
    );

    try {
      const applied = diff.applyPatch(originalContent, patches);
      if (applied !== false) {
        return { success: true, newContent: applied };
      }
    } catch (e: any) {
      return {
        success: false,
        error: `Failed to patch file: Search block could not be matched. Details: ${e.message}`,
      };
    }

    return {
      success: false,
      error: "Search block could not be found in the target file.",
    };
  }
}