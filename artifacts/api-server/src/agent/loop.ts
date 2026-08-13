import { SandboxRunner } from "../sandbox/runner";
import { DiagnosticsParser } from "../sandbox/diagnostics-parser";
import { DiffEngine } from "./diff-engine";

export interface AgentStepEvent {
  type: "plan" | "tool_call" | "tool_result" | "self_correct" | "success" | "error";
  message: string;
  data?: any;
}

export class AutonomousAgentLoop {
  private sandbox: SandboxRunner;
  private maxRetries = 4;

  constructor() {
    this.sandbox = new SandboxRunner();
  }

  /**
   * Executes a task, runs builds/tests, and self-corrects on errors
   */
  async executeTask(
    userPrompt: string,
    onEvent: (event: AgentStepEvent) => void
  ): Promise<boolean> {
    await this.sandbox.init();

    try {
      onEvent({ type: "plan", message: `Analyzing task: "${userPrompt}"` });

      let attempts = 0;
      let isPassing = false;

      while (attempts < this.maxRetries && !isPassing) {
        attempts++;

        // 1. Run typecheck & build verification in sandbox
        onEvent({
          type: "tool_call",
          message: `Running verification suite (Attempt ${attempts}/${this.maxRetries})...`,
        });

        const testResult = await this.sandbox.runCommand("pnpm run typecheck && pnpm test");

        if (testResult.exitCode === 0) {
          isPassing = true;
          onEvent({
            type: "success",
            message: "All type checks and tests passed cleanly.",
          });
          break;
        }

        // 2. Parse errors
        const diagnostics = DiagnosticsParser.parse(testResult.stderr || testResult.stdout);
        const formattedErrors = DiagnosticsParser.formatForLLM(diagnostics, testResult.stderr);

        onEvent({
          type: "self_correct",
          message: `Detected build failure. Triggering self-correction loop.`,
          data: { errors: formattedErrors },
        });

        // 3. Request patch from Llama using structured error feedback
        // (Call Cloudflare AI / Llama 3.3 model here with formattedErrors in context)
        // const patch = await callLlamaRepair(formattedErrors);
        // await this.applyPatch(patch);
      }

      return isPassing;
    } finally {
      await this.sandbox.close();
    }
  }
}