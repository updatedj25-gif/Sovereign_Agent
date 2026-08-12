import { spawn, ChildProcess } from "child_process";
import path from "path";
import { z } from "zod";
import { globalToolRegistry } from "../agent/tools/registry";

export interface CommandExecutionOptions {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export interface CommandExecutionResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  error?: string;
}

// Blocklist dangerous destructive commands from running in standard sandbox mode
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+-rf\s+\/($|\s)/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  />\s*\/dev\/sd[a-z]/i,
  /:()\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/i, // Fork bomb
];

/**
 * Sanitize environment variables passed to child process execution.
 */
function getSanitizedEnv(customEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const allowedVars = [
    "PATH",
    "HOME",
    "USER",
    "SHELL",
    "NODE_ENV",
    "PNPM_HOME",
    "LANG",
    "LC_ALL",
    "TERM",
  ];

  const sanitized: Record<string, string> = {};
  for (const key of allowedVars) {
    if (process.env[key]) {
      sanitized[key] = process.env[key]!;
    }
  }

  return {
    ...sanitized,
    ...customEnv,
  };
}

/**
 * Execute a terminal command in an isolated child process sandbox.
 */
export async function executeCommand(
  options: CommandExecutionOptions
): Promise<CommandExecutionResult> {
  const {
    command,
    args = [],
    cwd = process.cwd(),
    timeoutMs = 45000,
    env,
    onStdout,
    onStderr,
  } = options;

  const fullCommandLine = `${command} ${args.join(" ")}`.trim();

  // 1. Command Security Check
  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(fullCommandLine)) {
      return {
        success: false,
        exitCode: -1,
        stdout: "",
        stderr: "Command execution blocked by security sandbox rule.",
        durationMs: 0,
        error: "BLOCKED_COMMAND",
      };
    }
  }

  const startTime = Date.now();
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let childProcess: ChildProcess | null = null;
  let isTimedOut = false;

  return new Promise((resolve) => {
    // Determine shell execution mode
    const useShell = true;
    const workingDir = path.resolve(cwd);

    try {
      childProcess = spawn(fullCommandLine, {
        shell: useShell,
        cwd: workingDir,
        env: getSanitizedEnv(env),
      });
    } catch (err: any) {
      return resolve({
        success: false,
        exitCode: -1,
        stdout: "",
        stderr: err.message || String(err),
        durationMs: Date.now() - startTime,
        error: "SPAWN_ERROR",
      });
    }

    // Timeout Enforcer
    const timer = setTimeout(() => {
      isTimedOut = true;
      if (childProcess && !childProcess.killed) {
        childProcess.kill("SIGKILL");
      }
    }, timeoutMs);

    // Stream Stdout
    childProcess.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      stdoutBuffer += text;
      if (onStdout) onStdout(text);
    });

    // Stream Stderr
    childProcess.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      stderrBuffer += text;
      if (onStderr) onStderr(text);
    });

    childProcess.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        exitCode: -1,
        stdout: stdoutBuffer,
        stderr: stderrBuffer || err.message,
        durationMs: Date.now() - startTime,
        error: err.message,
      });
    });

    childProcess.on("close", (exitCode) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      if (isTimedOut) {
        return resolve({
          success: false,
          exitCode: null,
          stdout: stdoutBuffer,
          stderr: stderrBuffer + `\n[Process timed out after ${timeoutMs}ms]`,
          durationMs,
          error: "TIMEOUT",
        });
      }

      resolve({
        success: exitCode === 0,
        exitCode,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        durationMs,
      });
    });
  });
}

// ==========================================
// Register Execution Tool in Registry
// ==========================================

globalToolRegistry.registerTool({
  name: "run_terminal_command",
  description:
    "Execute a shell command inside the project workspace sandbox and return stdout/stderr logs.",
  requiresApproval: true,
  parameters: z.object({
    command: z.string().describe("Terminal command line string to execute (e.g. 'pnpm run typecheck')."),
    cwd: z.string().optional().describe("Optional working directory relative to root."),
    timeoutMs: z.number().optional().describe("Execution timeout in milliseconds (default: 45000ms)."),
  }),
  execute: async (args, context) => {
    const result = await executeCommand({
      command: args.command,
      cwd: args.cwd,
      timeoutMs: args.timeoutMs,
      onStdout: (text) => {
        context.emitEvent?.({
          type: "command_stdout",
          command: args.command,
          chunk: text,
        });
      },
      onStderr: (text) => {
        context.emitEvent?.({
          type: "command_stderr",
          command: args.command,
          chunk: text,
        });
      },
    });

    const outputLog = [
      `Exit Code: ${result.exitCode ?? "N/A"} (${result.durationMs}ms)`,
      result.stdout ? `\n--- STDOUT ---\n${result.stdout}` : "",
      result.stderr ? `\n--- STDERR ---\n${result.stderr}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      success: result.success,
      output: outputLog,
      data: {
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
      },
    };
  },
});