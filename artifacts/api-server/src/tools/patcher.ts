export interface PatchOptions {
  filePath: string;
  validateAst?: boolean;
}

export interface PatchResult {
  success: boolean;
  patchedCode?: string;
  matchedLine?: number;
  replacedLinesCount?: number;
  error?: string;
  astErrors?: string[];
}

/**
 * Applies precision search and replace block patch to source code
 */
export function applyBlockPatch(
  originalCode: string,
  searchBlock: string,
  replaceBlock: string,
  options?: PatchOptions
): PatchResult {
  if (!originalCode) {
    return { success: false, error: "Original code is empty." };
  }

  // 1. Exact Match Strategy
  if (originalCode.includes(searchBlock)) {
    const patchedCode = originalCode.replace(searchBlock, replaceBlock);
    return {
      success: true,
      patchedCode,
      matchedLine: originalCode.substring(0, originalCode.indexOf(searchBlock)).split("\n").length,
      replacedLinesCount: replaceBlock.split("\n").length,
    };
  }

  // 2. Trimmed Whitespace Line Matching Strategy
  const origLines = originalCode.split("\n");
  const searchLines = searchBlock.split("\n").map((l) => l.trim());

  for (let i = 0; i <= origLines.length - searchLines.length; i++) {
    let match = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (origLines[i + j].trim() !== searchLines[j]) {
        match = false;
        break;
      }
    }

    if (match) {
      const replaceLines = replaceBlock.split("\n");
      const newLines = [...origLines];
      newLines.splice(i, searchLines.length, ...replaceLines);

      return {
        success: true,
        patchedCode: newLines.join("\n"),
        matchedLine: i + 1,
        replacedLinesCount: replaceLines.length,
      };
    }
  }

  return {
    success: false,
    error: `SEARCH block not found in target file: ${options?.filePath || "unknown"}`,
  };
}