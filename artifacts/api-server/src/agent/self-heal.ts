import { ReActLoop, ReActMessage } from "./react-loop";
import { ToolRegistry } from "./tools/registry";
import { runVerificationSuite, VerificationResult, DiagnosticIssue } from "./verifier";

export interface SelfHealOptions {
  toolRegistry: ToolRegistry;
  modelProvider: (messages: ReActMessage[], tools: any[]) => Promise<ReActMessage>;
  maxRepairAttempts?: number;
  taskGroupId?: number;
  onEvent?: (data: Record<string, any>) => void;
  signal?: AbortSignal;
}

export interface SelfHealResult {
  healed: boolean;
  repairAttempts: number;
  finalVerification: VerificationResult;
  summary: string;
}

/**
 * Closed-Loop Self-Healing Orchestrator.
 * Auto-detects compiler/test errors and feeds structured diagnostic prompts back to ReAct loop until clean build.
 */
export async function attemptSelfHealingLoop(
  initialPrompt: string,
  options: SelfHealOptions
): Promise<SelfHealResult> {
  const {
    toolRegistry,
    modelProvider,
    maxRepairAttempts = 3,
    taskGroupId,
    onEvent,
    signal,
  } = options;

  const emit = (data: Record<string, any>) => {
    if (onEvent) onEvent(data);
  };

  emit({ type: "verification_started", message: "Running initial codebase verification..." });

  // 1. Run Initial Verification Pass
  let currentVerification = await runVerificationSuite({ scope: "all" });

  if (currentVerification.passed) {
    emit({ type: "verification_passed", message: "Initial verification passed cleanly without errors." });
    return {
      healed: true,
      repairAttempts: 0,
      finalVerification: currentVerification,
      summary: "Verification passed on initial run.",
    };
  }

  let attempts = 0;

  while (attempts < maxRepairAttempts) {
    if (signal?.aborted) {
      return {
        healed: false,
        repairAttempts: attempts,
        finalVerification: currentVerification,
        summary: "Self-healing loop cancelled by client signal.",
      };
    }

    attempts++;

    emit({
      type: "self_healing_attempt",
      attempt: attempts,
      maxAttempts: maxRepairAttempts,
      issuesCount: currentVerification.issues.length,
    });

    // 2. Format Structured Diagnostic Feedback for the Agent
    const repairPrompt = buildSelfHealingPrompt(
      initialPrompt,
      currentVerification.issues,
      attempts,
      maxRepairAttempts
    );

    const messages: ReActMessage[] = [
      {
        role: "system",
        content: `You are in self-healing repair mode. Your task is to fix specific diagnostic errors introduced in the codebase.
Analyze the provided error issues carefully, inspect the offending file lines using tools, apply precision patches, and ensure the build turns green.`,
      },
      {
        role: "user",
        content: repairPrompt,
      },
    ];

    // 3. Run ReAct repair cycle
    const loop = new ReActLoop({
      toolRegistry,
      maxIterations: 8,
      taskGroupId,
      onEvent,
      signal,
    });

    await loop.run(messages, modelProvider);

    // 4. Re-verify after repair iteration
    emit({ type: "verification_started", message: `Re-verifying build (Attempt ${attempts}/${maxRepairAttempts})...` });
    currentVerification = await runVerificationSuite({ scope: "all" });

    if (currentVerification.passed) {
      emit({
        type: "verification_passed",
        message: `Self-healing succeeded on repair attempt ${attempts}! Build is clean.`,
      });

      return {
        healed: true,
        repairAttempts: attempts,
        finalVerification: currentVerification,
        summary: `Successfully self-healed codebase errors after ${attempts} iteration(s).`,
      };
    }
  }

  // Max repair attempts exhausted
  emit({
    type: "self_healing_failed",
    message: `Self-healing exhausted ${maxRepairAttempts} repair attempts without resolving all errors.`,
    remainingIssues: currentVerification.issues.length,
  });

  return {
    healed: false,
    repairAttempts: attempts,
    finalVerification: currentVerification,
    summary: `Failed to resolve all errors after ${maxRepairAttempts} repair attempts.`,
  };
}

/**
 * Format structured diagnostic issues into an actionable prompt for the repair agent.
 */
function buildSelfHealingPrompt(
  userGoal: string,
  issues: DiagnosticIssue[],
  attemptNumber: number,
  maxAttempts: number
): string {
  const issueListFormatted = issues
    .map((issue, idx) => {
      const location = issue.filePath
        ? `${issue.filePath}${issue.line ? `:${issue.line}:${issue.column || 0}` : ""}`
        : "Global";

      return `${idx + 1}. [${issue.type.toUpperCase()}] at ${location}
   Error (${issue.code || "ERR"}): ${issue.message}`;
    })
    .join("\n\n");

  return `[SELF-HEALING REPAIR REQUEST - ATTEMPT ${attemptNumber}/${maxAttempts}]

Original User Objective: "${userGoal}"

The build or test suite failed with the following ${issues.length} diagnostic error(s):

${issueListFormatted}

Instructions for Repair:
1. Use \`read_file\` or \`search_workspace\` to inspect the file around the line numbers listed above.
2. Formulate a fix and apply it using \`patch_file\`.
3. Do not alter unrelated business logic or break existing features.`;
}