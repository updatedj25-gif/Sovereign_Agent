import { Sandbox } from "@e2b/code-interpreter";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class SandboxRunner {
  private sandbox: Sandbox | null = null;

  async init(apiKey?: string) {
    this.sandbox = await Sandbox.create({
      apiKey: apiKey || process.env.E2B_API_KEY,
    });
    return this;
  }

  async runCommand(cmd: string): Promise<ExecResult> {
    if (!this.sandbox) throw new Error("Sandbox not initialized");

    const exec = await this.sandbox.commands.run(cmd);
    return {
      stdout: exec.stdout,
      stderr: exec.stderr,
      exitCode: exec.exitCode ?? 0,
    };
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!this.sandbox) throw new Error("Sandbox not initialized");
    await this.sandbox.files.write(path, content);
  }

  async readFile(path: string): Promise<string> {
    if (!this.sandbox) throw new Error("Sandbox not initialized");
    return await this.sandbox.files.read(path);
  }

  async close() {
    if (this.sandbox) {
      await this.sandbox.kill();
      this.sandbox = null;
    }
  }
}