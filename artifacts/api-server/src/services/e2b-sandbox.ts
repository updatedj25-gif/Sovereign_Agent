import { Sandbox } from "e2b";

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class E2BSandboxManager {
  private static instanceMap = new Map<string, Sandbox>();

  /**
   * Get an existing E2B Sandbox for a session or spawn a fresh one.
   * If E2B_API_KEY is missing, operates in Mock/Dry-Run mode to prevent 500 crashes.
   */
  public static async getOrCreate(
    sessionId: string,
    timeoutMs: number = 10 * 60 * 1000 // Default 10 min
  ): Promise<Sandbox> {
    if (this.instanceMap.has(sessionId)) {
      return this.instanceMap.get(sessionId)!;
    }

    const apiKey = process.env.E2B_API_KEY;
    if (!apiKey) {
      console.warn(
        `[E2B Sandbox] E2B_API_KEY environment secret is missing. Operating in Mock/Dry-Run mode.`
      );

      // Return Mock Sandbox object for testing without API Key
      return {
        id: "mock-sandbox-id",
        getHost: (port: number) => `localhost:${port}`,
        commands: {
          run: async (cmd: string) => ({
            exitCode: 0,
            stdout: `[E2B Dry-Run Output for: "${cmd}"]\nSet E2B_API_KEY in .env to execute in real cloud micro-VMs.`,
            stderr: "",
          }),
        },
        files: {
          write: async () => {},
          read: async () => "// E2B Dry-Run File Content",
        },
        kill: async () => {},
      } as unknown as Sandbox;
    }

    console.log(`[E2B Sandbox] Spawning new sandbox for session: ${sessionId}`);
    const sandbox = await Sandbox.create({
      apiKey,
      timeoutMs,
    });

    // Initialize default workspace directory inside the Linux container
    await sandbox.commands.run("mkdir -p /home/user/workspace");

    this.instanceMap.set(sessionId, sandbox);
    return sandbox;
  }

  /**
   * Execute a shell command inside the ephemeral Linux container.
   */
  public static async executeCommand(
    sessionId: string,
    command: string,
    cwd: string = "/home/user/workspace",
    timeoutMs: number = 60_000
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      const sandbox = await this.getOrCreate(sessionId);
      console.log(`[E2B Exec] Executing command: "${command}" in ${cwd}`);
      const result = await sandbox.commands.run(command, {
        cwd,
        timeoutMs,
      });

      return {
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: err?.message || String(err),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Write code or text files into the container workspace.
   */
  public static async writeFile(
    sessionId: string,
    filePath: string,
    content: string
  ): Promise<void> {
    const sandbox = await this.getOrCreate(sessionId);
    await sandbox.files.write(filePath, content);
  }

  /**
   * Read file contents from the container workspace.
   */
  public static async readFile(
    sessionId: string,
    filePath: string
  ): Promise<string> {
    const sandbox = await this.getOrCreate(sessionId);
    return await sandbox.files.read(filePath);
  }

  /**
   * Safely terminate and clean up the sandbox.
   */
  public static async killSession(sessionId: string): Promise<void> {
    const sandbox = this.instanceMap.get(sessionId);
    if (sandbox) {
      console.log(`[E2B Sandbox] Terminating sandbox session: ${sessionId}`);
      try {
        await sandbox.kill();
      } catch (err) {
        console.error(`[E2B Sandbox] Error closing sandbox ${sessionId}:`, err);
      } finally {
        this.instanceMap.delete(sessionId);
      }
    }
  }
}