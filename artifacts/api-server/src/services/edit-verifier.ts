import { E2BSandboxManager } from "./e2b-sandbox";
import { DiffParserService } from "./diff-parser";
import { FuzzyDiffEngine, ApplyDiffResult } from "./fuzzy-diff-engine";

export interface VerificationResult {
  editApplied: boolean;
  applyResult?: ApplyDiffResult;
  verified: boolean;
  checkCommand?: string;
  typeCheckOutput?: string;
  errorMessage?: string;
}

export class EditVerificationService {
  /**
   * Applies LLM diff blocks, writes file to E2B sandbox, and runs auto-verification checks.
   */
  public static async applyAndVerify(
    sessionId: string,
    llmDiffResponse: string,
    options: {
      checkCommand?: string; // e.g. "npx tsc --noEmit" or "pnpm test"
      cwd?: string;
    } = {}
  ): Promise<VerificationResult> {
    const cwd = options.cwd || "/home/user/workspace";
    const checkCmd = options.checkCommand || "npx tsc --noEmit";

    // 1. Parse Search/Replace blocks
    const parsed = DiffParserService.parseSearchReplaceBlocks(llmDiffResponse);

    if (parsed.blocks.length === 0) {
      return {
        editApplied: false,
        verified: false,
        errorMessage: "No valid <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE blocks found.",
      };
    }

    const targetFilePath = parsed.filePath || parsed.blocks[0].filePath;
    if (!targetFilePath) {
      return {
        editApplied: false,
        verified: false,
        errorMessage: "Target file path could not be determined from diff blocks.",
      };
    }

    // 2. Read existing file from sandbox
    let existingContent = "";
    try {
      existingContent = await E2BSandboxManager.readFile(sessionId, targetFilePath);
    } catch {
      existingContent = ""; // New file creation
    }

    // 3. Apply Diff using Fuzzy Engine
    const applyResult = FuzzyDiffEngine.applyBlocks(
      targetFilePath,
      existingContent,
      parsed.blocks
    );

    if (!applyResult.success) {
      return {
        editApplied: false,
        applyResult,
        verified: false,
        errorMessage: `Failed to apply diff: ${applyResult.errors.join("; ")}`,
      };
    }

    // 4. Write modified file back to Sandbox
    await E2BSandboxManager.writeFile(sessionId, targetFilePath, applyResult.newContent);

    // 5. Run Verification Loop Command inside Sandbox
    console.log(`[Edit Verifier] Running verification check: "${checkCmd}"`);
    const verifyExec = await E2BSandboxManager.executeCommand(sessionId, checkCmd, cwd);

    const verified = verifyExec.exitCode === 0;

    return {
      editApplied: true,
      applyResult,
      verified,
      checkCommand: checkCmd,
      typeCheckOutput: verifyExec.exitCode !== 0 ? verifyExec.stderr || verifyExec.stdout : "Check passed cleanly.",
      errorMessage: verified ? undefined : `Verification check failed with exit code ${verifyExec.exitCode}`,
    };
  }
}