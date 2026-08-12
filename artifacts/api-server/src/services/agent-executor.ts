import { db, taskGroups, commands } from "@workspace/db";
import { eq } from "drizzle-orm";
import { E2BSandboxManager, ExecutionResult } from "./e2b-sandbox";

export interface AgentStep {
  title: string;
  command: string;
  cwd?: string;
}

export class AutonomousAgentExecutor {
  /**
   * Runs a series of dynamic agent steps inside E2B sandbox,
   * streams SSE events, and records full terminal outputs in PostgreSQL.
   */
  public static async runTaskPipeline(
    taskGroupId: number,
    sessionId: string,
    steps: AgentStep[],
    sendSSE: (eventData: object) => void
  ): Promise<boolean> {
    let allSuccess = true;

    // Update task group status to running
    await db
      .update(taskGroups)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(taskGroups.id, taskGroupId));

    for (const step of steps) {
      // 1. Send SSE progress to frontend
      sendSSE({
        type: "task_running",
        task: step.title,
        command: step.command,
        taskGroupId,
      });

      // 2. Execute command in real E2B container
      const result: ExecutionResult = await E2BSandboxManager.executeCommand(
        sessionId,
        step.command,
        step.cwd || "/home/user/workspace"
      );

      // 3. Persist exact stdout, stderr, exit_code in Postgres
      await db.insert(commands).values({
        taskGroupId,
        cmd: step.command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        createdAt: new Date(),
      });

      // 4. Stream output back to frontend
      sendSSE({
        type: "task_progress",
        task: step.title,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
      });

      // 5. Handle failure & automatic retry/recovery logic
      if (result.exitCode !== 0) {
        allSuccess = false;
        console.error(
          `[Agent Executor] Command failed: "${step.command}" with exit code ${result.exitCode}`
        );
        sendSSE({
          type: "error",
          task: step.title,
          message: `Command "${step.command}" failed with exit code ${result.exitCode}`,
          stderr: result.stderr,
        });
        break; // Stop execution loop on failure
      }
    }

    // Update final task group status in PostgreSQL
    const finalStatus = allSuccess ? "success" : "failed";
    await db
      .update(taskGroups)
      .set({
        status: finalStatus,
        summary: allSuccess
          ? "All steps completed successfully in sandbox."
          : "Execution halted due to step failure.",
        updatedAt: new Date(),
      })
      .where(eq(taskGroups.id, taskGroupId));

    return allSuccess;
  }
}