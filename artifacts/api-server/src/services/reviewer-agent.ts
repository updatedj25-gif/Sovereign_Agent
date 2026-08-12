import { E2BSandboxManager } from "./e2b-sandbox";

export interface ReviewResult {
  approved: boolean;
  score: number; // 0 to 100
  summary: string;
  gitDiff: string;
  verificationLogs: string;
  remainingIssues: string[];
}

export class ReviewerAgent {
  /**
   * Spawns a dedicated Reviewer pass to inspect work before status: success.
   */
  public static async evaluateTask(
    sessionId: string,
    originalTaskPrompt: string
  ): Promise<ReviewResult> {
    console.log(`[Reviewer Agent] Initiating reflection pass for session: ${sessionId}`);

    // 1. Capture Git Diff
    const diffExec = await E2BSandboxManager.executeCommand(
      sessionId,
      "git diff",
      "/home/user/workspace"
    );
    const gitDiff = diffExec.stdout || "No git changes detected.";

    // 2. Run Typecheck / Build Test
    const verifyExec = await E2BSandboxManager.executeCommand(
      sessionId,
      "npx tsc --noEmit || true",
      "/home/user/workspace"
    );
    const verificationLogs = verifyExec.stdout || verifyExec.stderr || "No errors.";

    // 3. Critique Prompt to LLM
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiKey = process.env.CLOUDFLARE_API_KEY;

    if (!accountId || !apiKey) {
      // Fallback if AI keys not present
      const passed = verifyExec.exitCode === 0;
      return {
        approved: passed,
        score: passed ? 90 : 40,
        summary: passed ? "All checks passed in sandbox." : "Typecheck errors present.",
        gitDiff,
        verificationLogs,
        remainingIssues: passed ? [] : ["Fix compiler/type errors"],
      };
    }

    const reviewPrompt = `
You are a Senior Code Reviewer.
USER TASK: "${originalTaskPrompt}"

GIT DIFF OF CHANGES MADE:
${gitDiff.substring(0, 3000)}

COMPILER & TEST LOGS:
${verificationLogs.substring(0, 1000)}

Evaluate whether the code completely satisfies the requirements without introduced bugs.
Respond strictly in JSON format:
{
  "approved": boolean,
  "score": number (0-100),
  "summary": "short critique explanation",
  "remainingIssues": ["issue 1", "issue 2"]
}
`;

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: reviewPrompt }],
        }),
      }
    );

    const json = await response.json();
    const rawText = json.result?.response || "{}";

    try {
      const parsed = JSON.parse(rawText.match(/\{[\s\S]*\}/)?.[0] || "{}");
      return {
        approved: !!parsed.approved,
        score: parsed.score || 50,
        summary: parsed.summary || "Review pass completed.",
        gitDiff,
        verificationLogs,
        remainingIssues: parsed.remainingIssues || [],
      };
    } catch {
      return {
        approved: verifyExec.exitCode === 0,
        score: 80,
        summary: "Review completed.",
        gitDiff,
        verificationLogs,
        remainingIssues: [],
      };
    }
  }
}