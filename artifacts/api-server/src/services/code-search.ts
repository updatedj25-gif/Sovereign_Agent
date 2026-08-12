import { E2BSandboxManager } from "./e2b-sandbox";

export interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

export class FastCodeSearchService {
  /**
   * High-speed pattern and symbol search using ripgrep inside E2B sandbox.
   */
  public static async ripgrep(
    sessionId: string,
    query: string,
    options: { cwd?: string; isRegex?: boolean; fileGlob?: string } = {}
  ): Promise<SearchMatch[]> {
    const cwd = options.cwd || "/home/user/workspace";
    const flags = [
      "-n", // Line numbers
      "--no-heading",
      "--color=never",
      "--max-count=100", // Limit results
      options.isRegex ? "" : "-F", // Fixed string vs regex
      options.fileGlob ? `-g '${options.fileGlob}'` : "",
    ]
      .filter(Boolean)
      .join(" ");

    // Ensure ripgrep is installed or fallback to grep
    const command = `rg ${flags} "${query}" . || grep -rn "${query}" .`;

    const exec = await E2BSandboxManager.executeCommand(sessionId, command, cwd);

    if (exec.exitCode !== 0 && !exec.stdout) {
      return [];
    }

    const matches: SearchMatch[] = [];
    const lines = exec.stdout.split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.split(":");
      if (parts.length >= 3) {
        const file = parts[0].replace("./", "");
        const lineNum = parseInt(parts[1], 10);
        const content = parts.slice(2).join(":").trim();

        if (!isNaN(lineNum)) {
          matches.push({ file, line: lineNum, content });
        }
      }
    }

    return matches;
  }

  /**
   * Locate files by name using find or glob pattern.
   */
  public static async findFiles(
    sessionId: string,
    pattern: string,
    cwd: string = "/home/user/workspace"
  ): Promise<string[]> {
    const command = `find . -type f -name "${pattern}" -not -path "*/node_modules/*" -not -path "*/.git/*"`;
    const exec = await E2BSandboxManager.executeCommand(sessionId, command, cwd);

    if (exec.exitCode !== 0) return [];
    return exec.stdout
      .split("\n")
      .map((f) => f.replace("./", "").trim())
      .filter(Boolean);
  }
}