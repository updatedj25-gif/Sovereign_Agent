import { E2BSandboxManager } from "./e2b-sandbox";

export interface GitCheckpoint {
  checkpointId: string;
  sessionId: string;
  stepName: string;
  gitTag: string;
  createdAt: Date;
}

export class GitCheckpointManager {
  private static checkpointHistory = new Map<string, GitCheckpoint[]>();

  /**
   * Creates a Git snapshot checkpoint before executing a step.
   */
  public static async createCheckpoint(
    sessionId: string,
    stepName: string,
    cwd: string = "/home/user/workspace"
  ): Promise<GitCheckpoint> {
    const timestamp = Date.now();
    const cleanStepName = stepName.replace(/[^a-zA-Z0-9]/g, "-").substring(0, 20);
    const gitTag = `checkpoint-${timestamp}-${cleanStepName}`;
    const checkpointId = `chk_${timestamp}`;

    console.log(`[Git Checkpoint] Creating snapshot "${gitTag}" for session: ${sessionId}`);

    // Ensure git user config exists in sandbox
    await E2BSandboxManager.executeCommand(
      sessionId,
      'git config user.name "SovereignAgent" && git config user.email "agent@sovereign.local"',
      cwd
    );

    // Stage and commit current state into temporary checkpoint commit
    const commitCmd = `git add -A && git commit -m "Checkpoint: ${stepName}" --allow-empty && git tag ${gitTag}`;
    await E2BSandboxManager.executeCommand(sessionId, commitCmd, cwd);

    const checkpoint: GitCheckpoint = {
      checkpointId,
      sessionId,
      stepName,
      gitTag,
      createdAt: new Date(),
    };

    const sessionCheckpoints = this.checkpointHistory.get(sessionId) || [];
    sessionCheckpoints.push(checkpoint);
    this.checkpointHistory.set(sessionId, sessionCheckpoints);

    return checkpoint;
  }

  /**
   * Reverts the sandbox workspace state to a previous Git checkpoint.
   */
  public static async rollbackToCheckpoint(
    sessionId: string,
    checkpointId: string,
    cwd: string = "/home/user/workspace"
  ): Promise<{ success: boolean; message: string }> {
    const checkpoints = this.checkpointHistory.get(sessionId) || [];
    const targetCheckpoint = checkpoints.find((c) => c.checkpointId === checkpointId);

    if (!targetCheckpoint) {
      return {
        success: false,
        message: `Checkpoint '${checkpointId}' not found for session ${sessionId}`,
      };
    }

    console.log(`[Git Checkpoint] Rolling back session ${sessionId} to tag: ${targetCheckpoint.gitTag}`);

    // Hard reset sandbox workspace to target git tag
    const rollbackCmd = `git reset --hard ${targetCheckpoint.gitTag} && git clean -fd`;
    const exec = await E2BSandboxManager.executeCommand(sessionId, rollbackCmd, cwd);

    if (exec.exitCode === 0) {
      return {
        success: true,
        message: `Workspace successfully reverted to step: "${targetCheckpoint.stepName}"`,
      };
    } else {
      return {
        success: false,
        message: `Rollback failed: ${exec.stderr || exec.stdout}`,
      };
    }
  }

  /**
   * List all available checkpoints for a session.
   */
  public static listCheckpoints(sessionId: string): GitCheckpoint[] {
    return this.checkpointHistory.get(sessionId) || [];
  }
}