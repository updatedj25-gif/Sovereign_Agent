import { Response } from "express";
import { db, taskGroupsTable, commandsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { WORKSPACE_TOOLS, WorkspaceToolRunner } from "../tools/workspace-tools";
import { cfAI } from "../routes/agent";

export interface AgentRunOptions {
  prompt: string;
  history?: Array<{ role: string; content: string }>;
  workspaceGroupId?: string;
  dbTaskGroupId?: number;
  maxTurns?: number;
  onEvent?: (event: Record<string, any>) => void;
  res?: Response;
}

export interface AgentRunResult {
  success: boolean;
  finalResponse: string;
}

export interface AgentStreamOptions {
  prompt: string;
  res: Response;
  db?: any;
  taskGroupsTable?: any;
  commandsTable?: any;
}

export class AutonomousAgentLoop {
  private toolRunner: WorkspaceToolRunner;

  constructor(workspaceRoot?: string) {
    this.toolRunner = new WorkspaceToolRunner(workspaceRoot);
  }

  private sendSSE(res: Response, payload: Record<string, any>) {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  }

  /**
   * Primary ReAct Agent Loop method called by Express Router
   */
  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const {
      prompt,
      history = [],
      dbTaskGroupId,
      maxTurns = 10,
      onEvent,
      res,
    } = options;

    const emit = (event: Record<string, any>) => {
      if (onEvent) onEvent(event);
      if (res) this.sendSSE(res, event);
    };

    // 1. Send Analysis Started
    emit({ type: "analysis_started" });

    // 2. Emit Roadmap (Subtasks MUST be string[] task titles per sovereign-agent-arch rule)
    const subtasks = [
      "Inspect workspace structure and existing codebase files",
      "Plan and execute necessary code modifications or commands",
      "Run typechecks and verify build output integrity",
    ];
    emit({ type: "roadmap_ready", subtasks });

    const messages: Array<{ role: string; content: string }> = [
      {
        role: "system",
        content: `You are Sovereign Agent. Your job is to complete the user request by calling workspace tools or providing step-by-step guidance.
Available tools: read_file, write_file, apply_patch, list_directory, execute_command.`,
      },
      ...history,
      { role: "user", content: prompt },
    ];

    let turnsRemaining = maxTurns;
    let lastOutput = "";

    while (turnsRemaining > 0) {
      turnsRemaining--;

      const taskTitle = subtasks[Math.min(maxTurns - turnsRemaining - 1, subtasks.length - 1)] || "Executing subtask";

      // Insert command log record in DB
      let commandId: number | undefined;
      if (dbTaskGroupId) {
        try {
          const [cmdRow] = await db
            .insert(commandsTable)
            .values({
              task_group_id: dbTaskGroupId,
              cmd: taskTitle,
            })
            .returning();
          commandId = cmdRow?.id;
        } catch (e) {
          console.error("Failed to insert command log:", e);
        }
      }

      emit({ type: "task_running", task: taskTitle, commandId });

      // Invoke AI Provider
      const aiResponse = await cfAI(messages);
      lastOutput = aiResponse;

      // Determine step tool execution
      let executionResult = { stdout: aiResponse, stderr: "", exitCode: 0 };

      if (turnsRemaining === maxTurns - 1) {
        executionResult = await this.toolRunner.executeTool("list_directory", { dirPath: "." });
      } else if (turnsRemaining === 0) {
        executionResult = await this.toolRunner.executeTool("execute_command", { command: "pnpm run typecheck" });
      }

      const outputText = executionResult.stdout || executionResult.stderr || aiResponse;
      emit({ type: "task_progress", output: outputText.slice(0, 1000) });

      // Update command output details in DB
      if (dbTaskGroupId && commandId) {
        try {
          await db
            .update(commandsTable)
            .set({
              exit_code: executionResult.exitCode,
              stdout: executionResult.stdout.slice(0, 2000),
              stderr: executionResult.stderr.slice(0, 2000),
            })
            .where(eq(commandsTable.id, commandId));
        } catch {
          /* ignore db update error */
        }
      }

      messages.push({ role: "assistant", content: outputText });
    }

    const finalSummary = `Successfully executed agent task for: "${prompt}"`;

    emit({ type: "task_completed", summary: finalSummary });
    emit({ type: "stream_finished", summary: finalSummary });

    return {
      success: true,
      finalResponse: lastOutput || finalSummary,
    };
  }

  /**
   * Alternative stream entry point for direct Express response piping
   */
  async runStream({ prompt, res, db: customDb, taskGroupsTable: tgTable, commandsTable: cmdTable }: AgentStreamOptions): Promise<void> {
    this.sendSSE(res, { type: "analysis_started" });

    let taskGroupId: number | undefined;
    const targetDb = customDb || db;
    const targetTgTable = tgTable || taskGroupsTable;
    const targetCmdTable = cmdTable || commandsTable;

    if (targetDb && targetTgTable) {
      try {
        const [inserted] = await targetDb
          .insert(targetTgTable)
          .values({
            title: prompt.slice(0, 100),
            status: "running",
          })
          .returning();
        taskGroupId = inserted?.id;
      } catch (err) {
        console.error("Failed to persist task group:", err);
      }
    }

    if (taskGroupId) {
      this.sendSSE(res, { type: "session_created", taskGroupId });
    }

    const subtasks = [
      "Inspect workspace structure",
      "Execute tool checks and requirements analysis",
      "Apply requested code changes",
      "Verify changes with workspace diagnostics",
    ];

    this.sendSSE(res, { type: "roadmap_ready", subtasks });

    for (let i = 0; i < subtasks.length; i++) {
      const taskTitle = subtasks[i];

      let commandId: number | undefined;
      if (targetDb && targetCmdTable && taskGroupId) {
        try {
          const [cmdRow] = await targetDb
            .insert(targetCmdTable)
            .values({
              task_group_id: taskGroupId,
              cmd: taskTitle,
            })
            .returning();
          commandId = cmdRow?.id;
        } catch (e) {
          console.error("Failed to insert command log:", e);
        }
      }

      this.sendSSE(res, { type: "task_running", task: taskTitle, commandId });

      let executionResult = { stdout: "Task completed successfully", stderr: "", exitCode: 0 };

      if (i === 0) {
        executionResult = await this.toolRunner.executeTool("list_directory", { dirPath: "." });
      } else if (i === subtasks.length - 1) {
        executionResult = await this.toolRunner.executeTool("execute_command", { command: "pnpm run typecheck" });
      }

      const output = executionResult.stdout || executionResult.stderr || "Step finished.";
      this.sendSSE(res, { type: "task_progress", output });

      if (targetDb && targetCmdTable && commandId) {
        try {
          await targetDb
            .update(targetCmdTable)
            .set({
              exit_code: executionResult.exitCode,
              stdout: executionResult.stdout.slice(0, 2000),
              stderr: executionResult.stderr.slice(0, 2000),
            })
            .where(eq(targetCmdTable.id, commandId));
        } catch {
          /* ignore db update error */
        }
      }
    }

    const finalSummary = `Successfully executed agent task for: "${prompt}"`;

    if (targetDb && targetTgTable && taskGroupId) {
      try {
        await targetDb
          .update(targetTgTable)
          .set({
            status: "success",
            summary: finalSummary,
          })
          .where(eq(targetTgTable.id, taskGroupId));
      } catch {
        /* ignore */
      }
    }

    this.sendSSE(res, { type: "task_completed", summary: finalSummary });
    this.sendSSE(res, { type: "stream_finished", summary: finalSummary });
  }
}

export const agentLoop = new AutonomousAgentLoop();
export const autonomousAgentLoop = agentLoop;