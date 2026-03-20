import { exec } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { updateIssue } from "../db/repositories/issues.js";
import { shellQuote } from "./shell.js";
import { toContainerPath } from "../utils/paths.js";
import type { Repo, Issue } from "../types/entities.js";

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
): Promise<{ path: string; branchName: string }> {
  const branchName = `crewdeck/${issue.id.slice(0, 8)}-${slugify(issue.title)}`;
  const repoPath = toContainerPath(repo.local_path);
  const worktreePath = join(tmpdir(), "crewdeck-worktrees", branchName);

  // Try to fetch latest from origin
  let fetchSucceeded = false;
  try {
    await execAsync(`git -C ${shellQuote(repoPath)} fetch origin`);
    fetchSucceeded = true;
  } catch (err) {
    console.warn(`Failed to fetch from origin, using local branch: ${err}`);
  }

  const startPoint = fetchSucceeded ? `origin/${baseBranch}` : baseBranch;
  await execAsync(
    `git -C ${shellQuote(repoPath)} worktree add -b ${shellQuote(branchName)} ${shellQuote(worktreePath)} ${shellQuote(startPoint)}`,
  );

  updateIssue(issue.id, {
    branch_name: branchName,
    worktree_path: worktreePath,
    base_branch: baseBranch,
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
    // Best-effort branch deletion — ignore if branch has unmerged changes
    try {
      await execAsync(
        `git -C ${shellQuote(repoPath)} branch -d ${shellQuote(branchName)}`,
      );
    } catch {
      // Branch may have unmerged commits — leave it
    }
  }
}
