import { exec } from "node:child_process";
import path from "node:path";

export interface ExecutionOptions {
  cwd?: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
  env?: Record<string, string>;
}

export interface ExecutionOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export class SandboxExecutor {
  private static DEFAULT_TIMEOUT = 60000; // 60 seconds
  private static DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10MB

  static async runCommand(
    command: string,
    options: ExecutionOptions = {}
  ): Promise<ExecutionOutput> {
    const startTime = Date.now();
    const timeout = options.timeoutMs ?? this.DEFAULT_TIMEOUT;
    const maxBuffer = options.maxBufferBytes ?? this.DEFAULT_MAX_BUFFER;
    const workingDir = options.cwd ? path.resolve(options.cwd) : process.cwd();

    return new Promise((resolve) => {
      let timedOut = false;

      const child = exec(
        command,
        {
          cwd: workingDir,
          timeout,
          maxBuffer,
          env: { ...process.env, ...options.env },
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - startTime;

          if (error && error.killed) {
            timedOut = true;
          }

          resolve({
            exitCode: error ? error.code ?? 1 : 0,
            stdout: stdout.toString().trim(),
            stderr: stderr.toString().trim(),
            durationMs,
            timedOut,
          });
        }
      );
    });
  }
}