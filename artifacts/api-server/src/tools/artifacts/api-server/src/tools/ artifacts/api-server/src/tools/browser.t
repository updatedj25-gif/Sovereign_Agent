import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";
import { globalToolRegistry, ToolExecutionResult, ToolExecutionContext } from "../agent/registry";

export interface ProcessLogEntry {
  processName: string;
  lines: string[];
  hasError: boolean;
  timestamp: string;
}

// Global in-memory log buffer tracking active background process outputs
export class ProcessLogBuffer {
  private static buffers = new Map<string, string[]>();
  private static MAX_LINES = 500;

  public static appendLog(processName: string, text: string): void {
    const existing = this.buffers.get(processName) || [];
    const newLines = text.split("\n").filter(Boolean);
    const updated = [...existing, ...newLines].slice(-this.MAX_LINES);
    this.buffers.set(processName, updated);
  }

  public static getLogs(
    processName: string,
    tailLinesCount: number = 50,
    filterErrorOnly: boolean = false
  ): string[] {
    const lines = this.buffers.get(processName) || [];
    let filtered = lines;

    if (filterErrorOnly) {
      filtered = lines.filter((l) =>
        /error|exception|fail|rejected|unhandled|500/i.test(l)
      );
    }

    return filtered.slice(-tailLinesCount);
  }

  public static listActiveProcesses(): string[] {
    return Array.from(this.buffers.keys());
  }

  public static clearBuffer(processName: string): void {
    this.buffers.delete(processName);
  }
}

/**
 * Scan log files in project directories (e.g. pino log files, .log files)
 */
export async function readLogFile(
  logFilePath: string,
  tailLinesCount: number = 50
): Promise<string[]> {
  const fullPath = path.resolve(process.cwd(), logFilePath);
  const content = await fs.readFile(fullPath, "utf-8");
  const lines = content.split("\n").filter(Boolean);
  return lines.slice(-tailLinesCount);
}

// ==========================================
// Register Process & Log Monitoring Tools
// ==========================================

globalToolRegistry.registerTool({
  name: "tail_process_logs",
  description:
    "Tail and inspect recent stdout/stderr output lines from active background processes (e.g. dev server, API server, background tasks).",
  parameters: z.object({
    processName: z
      .string()
      .optional()
      .describe("Name of the background process (defaults to 'api-server' or 'dev')."),
    tailLinesCount: z.number().optional().describe("Number of recent log lines to return (default: 50)."),
    filterErrorOnly: z.boolean().optional().describe("Filter output to show only error log lines."),
  }),
  execute: async (args, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const targetProcess = args.processName || "api-server";
    const lines = ProcessLogBuffer.getLogs(
      targetProcess,
      args.tailLinesCount || 50,
      args.filterErrorOnly || false
    );

    const activeList = ProcessLogBuffer.listActiveProcesses();

    if (lines.length === 0) {
      return {
        success: true,
        output: `No recent logs buffered for process '${targetProcess}'.\nActive monitored processes: ${
          activeList.join(", ") || "none"
        }`,
        data: { activeProcesses: activeList },
      };
    }

    return {
      success: true,
      output: `TAIL LOGS [${targetProcess}] (Last ${lines.length} lines):\n\n${lines.join("\n")}`,
      data: {
        processName: targetProcess,
        linesCount: lines.length,
        lines,
      },
    };
  },
});

globalToolRegistry.registerTool({
  name: "inspect_server_logs",
  description:
    "Scan project log files for runtime errors, unhandled promise rejections, 500 status codes, or stack traces.",
  parameters: z.object({
    logFilePath: z.string().describe("Relative file path to log file (e.g. 'logs/server.log')."),
    tailLinesCount: z.number().optional().describe("Number of recent lines to scan (default: 50)."),
  }),
  execute: async (args, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    try {
      context.emitEvent?.({
        type: "inspect_logs_started",
        filePath: args.logFilePath,
      });

      const lines = await readLogFile(args.logFilePath, args.tailLinesCount || 50);

      const errorLines = lines.filter((l) =>
        /error|exception|fail|rejected|500/i.test(l)
      );

      return {
        success: true,
        output: `Log Inspection for '${args.logFilePath}' (${lines.length} lines, ${errorLines.length} error lines):\n\n${lines.join("\n")}`,
        data: {
          filePath: args.logFilePath,
          totalLines: lines.length,
          errorCount: errorLines.length,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Failed to read log file '${args.logFilePath}': ${err.message}`,
        error: "LOG_READ_FAILED",
      };
    }
  },
});
