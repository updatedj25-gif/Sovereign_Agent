import * as path from "node:path";
import * as fs from "node:fs/promises";

export class DiffEngine {
  constructor(private workspaceRoot: string) {}

  async applyPatch(filePath: string, target: string, replacement: string) {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.workspaceRoot, filePath);
    const content = await fs.readFile(fullPath, "utf-8");
    if (!content.includes(target)) {
      throw new Error(`Target string not found in ${filePath}`);
    }
    const updated = content.replace(target, replacement);
    await fs.writeFile(fullPath, updated, "utf-8");
    return updated;
  }
}
