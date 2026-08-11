import * as path from "node:path";

export class SandboxSecurityError extends Error {}

export function assertSafePath(workspaceRoot: string, relPath: string): string {
  const full = path.resolve(workspaceRoot, relPath);
  if (!full.startsWith(workspaceRoot)) {
    throw new SandboxSecurityError(`Path ${relPath} escapes workspace root`);
  }
  return full;
}
