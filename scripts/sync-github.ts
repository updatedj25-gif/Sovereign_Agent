import { execSync } from "child_process";

async function syncGithub() {
  const token = process.env.GITHUB_API_TOKEN || process.env.GITHUB_TOKEN;
  const repoUrl = process.env.GITHUB_REPO_URL || "https://github.com/updatedj25-gif/Sovereign_Agent.git";

  console.log("⚡ Starting Sovereign Agent GitHub Sync...");

  try {
    // Configure git identity
    execSync('git config user.name "updatedj25-gif"', { stdio: "inherit" });
    execSync('git config user.email "updatedj25@gmail.com"', { stdio: "inherit" });

    // Configure remote with token if available
    if (token) {
      const cleanRepo = repoUrl.replace(/^https?:\/\//, "").replace(/^.*@/, "");
      const authenticatedUrl = `https://x-access-token:${token}@${cleanRepo}`;
      execSync(`git remote set-url origin "${authenticatedUrl}"`, { stdio: "inherit" });
      console.log("🔒 Configured authenticated git remote.");
    }

    // Stage all changes
    console.log("📦 Staging working tree...");
    execSync("git add -A", { stdio: "inherit" });

    // Check if there are changes to commit
    const status = execSync("git status --porcelain").toString().trim();
    if (status) {
      const commitMsg = process.argv[2] || `feat: sync sovereign agent codebase updates (${new Date().toISOString()})`;
      console.log(`📝 Committing changes: "${commitMsg}"`);
      execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { stdio: "inherit" });
    } else {
      console.log("ℹ️ No uncommitted changes.");
    }

    // Fetch and rebase / push
    console.log("🚀 Pushing to origin main...");
    execSync("git push origin main", { stdio: "inherit" });

    console.log("✅ Successfully synced with origin main!");
  } catch (error: any) {
    console.error("❌ Sync failed:", error.message || error);
    process.exit(1);
  }
}

syncGithub();
