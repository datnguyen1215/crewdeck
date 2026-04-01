import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { updateIssue } from "../db/repositories/issues.js";
import { shellQuote } from "./shell.js";
import { toContainerPath } from "../utils/paths.js";
import { createGitSshEnv, cleanupSshKey } from "../utils/git-auth.js";
import type { Repo, Issue } from "../types/entities.js";
import { logger } from "../logger.js";

const execAsync = promisify(exec);

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function createWorktree(
  repo: Repo,
  issue: Issue,
  baseBranch: string,
  sshPrivateKey?: string,
): Promise<{ path: string; branchName: string }> {
  const branchName = `crewdeck/${issue.id.slice(0, 8)}-${slugify(issue.title)}`;
  const repoPath = toContainerPath(repo.local_path);
  const worktreePath = join(tmpdir(), "crewdeck-worktrees", branchName);

  // Try to fetch latest from origin (with SSH credentials if available)
  let fetchSucceeded = false;
  const ssh = sshPrivateKey ? createGitSshEnv(sshPrivateKey) : null;
  try {
    const fetchEnv = { ...process.env, ...ssh?.env, GIT_TERMINAL_PROMPT: "0" };
    await execAsync(`git -C ${shellQuote(repoPath)} fetch origin`, {
      env: fetchEnv,
    });
    fetchSucceeded = true;
  } catch (err) {
    console.warn(`Failed to fetch from origin, using local branch: ${err}`);
  } finally {
    if (ssh) cleanupSshKey(ssh.keyPath);
  }

  const startPoint = fetchSucceeded ? `origin/${baseBranch}` : baseBranch;

  // Prune stale worktree entries (e.g. after /tmp was cleaned on reboot)
  await execAsync(`git -C ${shellQuote(repoPath)} worktree prune`);

  // If the branch already exists (from a previous run), reuse it instead of -b
  let branchExists = false;
  try {
    await execAsync(
      `git -C ${shellQuote(repoPath)} rev-parse --verify ${shellQuote(branchName)}`,
    );
    branchExists = true;
  } catch {
    // Branch doesn't exist
    logger.debug({ branchName }, "Branch does not exist, will create");
  }

  if (branchExists) {
    await execAsync(
      `git -C ${shellQuote(repoPath)} worktree add ${shellQuote(worktreePath)} ${shellQuote(branchName)}`,
    );

    // Rebase onto latest main so the agent doesn't work on a stale base
    if (fetchSucceeded) {
      try {
        await execAsync(
          `git -C ${shellQuote(worktreePath)} rebase ${shellQuote(startPoint)}`,
        );
      } catch (err) {
        // Abort the rebase if it fails (e.g. conflicts) — agent starts with what it had
        await execAsync(
          `git -C ${shellQuote(worktreePath)} rebase --abort`,
        ).catch(() => {});
        console.warn(
          `Failed to rebase ${branchName} onto ${startPoint}: ${err}`,
        );
      }
    }
  } else {
    await execAsync(
      `git -C ${shellQuote(repoPath)} worktree add -b ${shellQuote(branchName)} ${shellQuote(worktreePath)} ${shellQuote(startPoint)}`,
    );
  }

  // Inject Claude Code settings to disable AI attribution in commits/PRs
  const claudeDir = join(worktreePath, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    join(claudeDir, "settings.json"),
    JSON.stringify({ attribution: { commit: "", pr: "" } }),
  );

  updateIssue(issue.id, {
    branch_name: branchName,
    worktree_path: worktreePath,
    base_branch: baseBranch,
    repo_id: repo.id,
  });

  return { path: worktreePath, branchName };
}

export async function cleanupWorktree(
  repo: Repo,
  worktreePath: string,
  branchName: string,
  deleteBranch = false,
): Promise<void> {
  const repoPath = toContainerPath(repo.local_path);
  await execAsync(
    `git -C ${shellQuote(repoPath)} worktree remove ${shellQuote(worktreePath)} --force`,
  );

  if (deleteBranch) {
    try {
      await execAsync(
        `git -C ${shellQuote(repoPath)} branch -d ${shellQuote(branchName)}`,
      );
    } catch {
      // Branch may have unmerged commits — leave it
      logger.debug(
        { branchName },
        "Branch delete skipped (may have unmerged commits)",
      );
    }
  }
}
