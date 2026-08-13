export interface DiagnosticError {
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  message: string;
  raw: string;
}

export class DiagnosticsParser {
  /**
   * Parses TypeScript compiler (tsc), Vite, and Vitest error output
   */
  static parse(output: string): DiagnosticError[] {
    const errors: DiagnosticError[] = [];
    const lines = output.split("\n");

    // Matches: src/app.ts:42:15 - error TS2304: Cannot find name 'db'.
    const tsRegex = /^(.+?):(\d+):(\d+)\s+-\s+error\s+(TS\d+):\s+(.+)$/;
    // Matches: [vite] Internal server error: ...
    const viteRegex = /\[vite\]\s+(?:Internal server error:)?\s*(.+)/i;

    for (const line of lines) {
      const tsMatch = line.match(tsRegex);
      if (tsMatch) {
        errors.push({
          file: tsMatch[1].trim(),
          line: parseInt(tsMatch[2], 10),
          column: parseInt(tsMatch[3], 10),
          code: tsMatch[4],
          message: tsMatch[5],
          raw: line,
        });
        continue;
      }

      const viteMatch = line.match(viteRegex);
      if (viteMatch) {
        errors.push({
          message: viteMatch[1].trim(),
          raw: line,
        });
      }
    }

    return errors;
  }

  /**
   * Compacts errors into a lean prompt string for Llama context injection
   */
  static formatForLLM(diagnostics: DiagnosticError[], rawStderr: string): string {
    if (diagnostics.length === 0) {
      // Return last 20 lines of raw stderr if structured parsing didn't catch specific format
      return rawStderr.split("\n").slice(-20).join("\n");
    }

    return diagnostics
      .map(
        (d) =>
          `FILE: ${d.file || "unknown"} (Line ${d.line || "?"}, Col ${d.column || "?"}): [${d.code || "ERR"}] ${d.message}`
      )
      .join("\n");
  }
}