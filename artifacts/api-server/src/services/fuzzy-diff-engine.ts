import { SearchReplaceBlock } from "./diff-parser";

export interface ApplyDiffResult {
  success: boolean;
  filePath: string;
  newContent: string;
  appliedBlocksCount: number;
  failedBlocksCount: number;
  errors: string[];
  matchStrategyUsed: "exact" | "whitespace_normalized" | "fuzzy_sliding" | "failed";
}

export class FuzzyDiffEngine {
  /**
   * Applies a series of SEARCH/REPLACE blocks onto target file content.
   */
  public static applyBlocks(
    filePath: string,
    originalContent: string,
    blocks: SearchReplaceBlock[]
  ): ApplyDiffResult {
    let currentContent = originalContent;
    let appliedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];
    let overallStrategy: "exact" | "whitespace_normalized" | "fuzzy_sliding" | "failed" = "exact";

    for (const block of blocks) {
      const searchStr = block.searchBlock;
      const replaceStr = block.replaceBlock;

      // Strategy 1: Exact Match
      if (currentContent.includes(searchStr)) {
        currentContent = currentContent.replace(searchStr, replaceStr);
        appliedCount++;
        continue;
      }

      // Strategy 2: Whitespace & Line Ending Normalized Match
      const normalizedResult = this.applyWhitespaceNormalized(currentContent, searchStr, replaceStr);
      if (normalizedResult.matched) {
        currentContent = normalizedResult.content;
        appliedCount++;
        overallStrategy = "whitespace_normalized";
        continue;
      }

      // Strategy 3: Sliding Window Fuzzy Match (Levenshtein / Similarity threshold)
      const fuzzyResult = this.applyFuzzySlidingWindow(currentContent, searchStr, replaceStr);
      if (fuzzyResult.matched) {
        currentContent = fuzzyResult.content;
        appliedCount++;
        overallStrategy = "fuzzy_sliding";
        continue;
      }

      // If all strategies fail
      failedCount++;
      errors.push(
        `Failed to locate SEARCH block in ${filePath}:\n"${searchStr.substring(0, 80)}..."`
      );
    }

    return {
      success: failedCount === 0 && appliedCount > 0,
      filePath,
      newContent: currentContent,
      appliedBlocksCount: appliedCount,
      failedBlocksCount: failedCount,
      errors,
      matchStrategyUsed: failedCount === 0 ? overallStrategy : "failed",
    };
  }

  /**
   * Normalizes whitespace/indentation for line matching.
   */
  private static applyWhitespaceNormalized(
    content: string,
    searchBlock: string,
    replaceBlock: string
  ): { matched: boolean; content: string } {
    const contentLines = content.split("\n");
    const searchLines = searchBlock.split("\n").map((l) => l.trim());

    for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
      let match = true;
      for (let j = 0; j < searchLines.length; j++) {
        if (contentLines[i + j].trim() !== searchLines[j]) {
          match = false;
          break;
        }
      }

      if (match) {
        // Replace target line window while preserving original file line structure
        const replaceLines = replaceBlock.split("\n");
        contentLines.splice(i, searchLines.length, ...replaceLines);
        return { matched: true, content: contentLines.join("\n") };
      }
    }

    return { matched: false, content };
  }

  /**
   * Sliding Window Fuzzy Line Matcher (handles minor line drift or typos).
   */
  private static applyFuzzySlidingWindow(
    content: string,
    searchBlock: string,
    replaceBlock: string,
    similarityThreshold: number = 0.8
  ): { matched: boolean; content: string } {
    const contentLines = content.split("\n");
    const searchLines = searchBlock.split("\n");
    const searchClean = searchBlock.replace(/\s+/g, "");

    let bestScore = 0;
    let bestIndex = -1;

    for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
      const windowChunk = contentLines.slice(i, i + searchLines.length).join("\n");
      const windowClean = windowChunk.replace(/\s+/g, "");

      const score = calculateStringSimilarity(searchClean, windowClean);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestScore >= similarityThreshold && bestIndex !== -1) {
      const replaceLines = replaceBlock.split("\n");
      contentLines.splice(bestIndex, searchLines.length, ...replaceLines);
      return { matched: true, content: contentLines.join("\n") };
    }

    return { matched: false, content };
  }
}

/**
 * Calculates string similarity ratio (0.0 to 1.0)
 */
function calculateStringSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1.0;
  if (!str1 || !str2) return 0.0;

  const len1 = str1.length;
  const len2 = str2.length;
  const maxLen = Math.max(len1, len2);
  let matches = 0;

  for (let i = 0; i < Math.min(len1, len2); i++) {
    if (str1[i] === str2[i]) matches++;
  }

  return matches / maxLen;
}