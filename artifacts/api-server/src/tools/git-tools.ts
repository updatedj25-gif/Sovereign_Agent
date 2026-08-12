import { z } from "zod";
import { globalToolRegistry, ToolExecutionResult, ToolExecutionContext } from "../agent/registry";
import { executeCommand } from "./executor";

export interface PullRequestOptions {
  owner: string;
  repo: string;
  title: string;
  body: string;
  headBranch: string;
  baseBranch?: string;
}

/**
 * Revert a specific file to its HEAD committed state
 */
export async function revertSingleFile(filePath: string): Promise<boolean> {
  const command = `git checkout HEAD -- "${filePath}" && git clean -fd "${filePath}"`;
  const result = await executeCommand({ command });
  return result.success;
}

/**
 * Create a GitHub Pull Request via GitHub REST API
 */
export async function createGitHubPullRequest(
  options: PullRequestOptions
): Promise<{ prNumber: number; prUrl: string; title: string }> {
  const { owner, repo, title, body, headBranch, baseBranch = "main" } = options;
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error("GITHUB_TOKEN environment secret is required to create a Pull Request.");
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/pulls`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "Sovereign-Agent-Server",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      body,
      head: headBranch,
      base: baseBranch,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub PR Creation Failed (HTTP ${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as any;

  return {
    prNumber: data.number,
    prUrl: data.html_url,
    title: data.title,
  };
}

// ==========================================
// Register Advanced Git Tools
// ==========================================

globalToolRegistry.registerTool({
  name: "git_branch_manage",
  description:
    "Manage Git branches: list branches, create new feature branch, or switch current branch.",
  parameters: z.object({
    action: z.enum(["list", "create", "switch", "delete"]).describe("Branch operation action."),
    branchName: z.string().optional().describe("Branch name required for create, switch, or delete."),
  }),
  execute: async (args, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    let command = "git branch -a";

    if (args.action === "create") {
      if (!args.branchName) {
        return { success: false, output: "branchName is required to create a branch.", error: "MISSING_BRANCH_NAME" };
      }
      command = `git checkout -b "${args.branchName}"`;
    } else if (args.action === "switch") {
      if (!args.branchName) {
        return { success: false, output: "branchName is required to switch branches.", error: "MISSING_BRANCH_NAME" };
      }
      command = `git checkout "${args.branchName}"`;
    } else if (args.action === "delete") {
      if (!args.branchName) {
        return { success: false, output: "branchName is required to delete a branch.", error: "MISSING_BRANCH_NAME" };
      }
      command = `git branch -D "${args.branchName}"`;
    }

    context.emitEvent?.({
      type: "git_branch_started",
      action: args.action,
      command,
    });

    const res = await executeCommand({ command });

    return {
      success: res.success,
      output: `Executed: ${command}\n\n${res.stdout || res.stderr || "Branch operation complete."}`,
      data: { command, exitCode: res.exitCode },
    };
  },
});

globalToolRegistry.registerTool({
  name: "git_file_revert",
  description:
    "Revert a specific uncommitted file back to its HEAD committed state without losing edits in other files.",
  requiresApproval: true,
  parameters: z.object({
    filePath: z.string().describe("Relative path of the file to revert."),
  }),
  execute: async (args, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    try {
      context.emitEvent?.({
        type: "git_file_revert_started",
        filePath: args.filePath,
      });

      const success = await revertSingleFile(args.filePath);

      if (!success) {
        return {
          success: false,
          output: `Failed to revert file '${args.filePath}'. Verify the file path exists in Git history.`,
          error: "FILE_REVERT_FAILED",
        };
      }

      return {
        success: true,
        output: `Successfully reverted '${args.filePath}' back to HEAD committed state.`,
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Git File Revert Error: ${err.message}`,
        error: "REVERT_ERROR",
      };
    }
  },
});

globalToolRegistry.registerTool({
  name: "create_pull_request",
  description:
    "Open a GitHub Pull Request with structured title, description, and target base branch.",
  requiresApproval: true,
  parameters: z.object({
    owner: z.string().describe("GitHub repository owner/organization."),
    repo: z.string().describe("GitHub repository name."),
    title: z.string().describe("PR title."),
    body: z.string().describe("PR summary markdown description."),
    headBranch: z.string().describe("Feature branch name containing changes."),
    baseBranch: z.string().optional().describe("Target base branch to merge into (default: 'main')."),
  }),
  execute: async (args, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    try {
      context.emitEvent?.({
        type: "pr_creation_started",
        title: args.title,
        headBranch: args.headBranch,
      });

      const pr = await createGitHubPullRequest({
        owner: args.owner || context.owner || "",
        repo: args.repo || context.repo || "",
        title: args.title,
        body: args.body,
        headBranch: args.headBranch,
        baseBranch: args.baseBranch || "main",
      });

      return {
        success: true,
        output: `Successfully created Pull Request #${pr.prNumber}: "${pr.title}"\nURL: ${pr.prUrl}`,
        data: pr,
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Create PR Failed: ${err.message}`,
        error: "PR_CREATION_FAILED",
      };
    }
  },
});
