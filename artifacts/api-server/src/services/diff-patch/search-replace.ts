export function applySearchReplaceBlock(content: string, search: string, replace: string): string {
  if (!content.includes(search)) {
    throw new Error("Search block not found in content");
  }
  return content.replace(search, replace);
}
