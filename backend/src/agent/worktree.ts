import { exec } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { updateIssue } from "../db/repositories/issues.js";
import { shellQuote } from "./adapters/claude-code.js";
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
  baseBranch: string
): Promise<string> {
  const branchName = `crewdeck/${issue.id.slice(0, 8)}-${slugify(issue.title)}`;
  const worktreePath = join(repo.local_path, ".worktrees", branchName);

  await execAsync(
    `git -C ${shellQuote(repo.local_path)} worktree add -b ${shellQuote(branchName)} ${shellQuote(worktreePath)} ${shellQuote(baseBranch)}`
  );

  updateIssue(issue.id, {
    branch_name: branchName,
    worktree_path: worktreePath,
    base_branch: baseBranch,
  });

  return worktreePath;
}

export async function cleanupWorktree(
  repo: Repo,
  worktreePath: string,
  branchName: string,
  deleteBranch = false
): Promise<void> {
  await execAsync(
    `git -C ${shellQuote(repo.local_path)} worktree remove ${shellQuote(worktreePath)} --force`
  );

  if (deleteBranch) {
    // Best-effort branch deletion — ignore if branch has unmerged changes
    try {
      await execAsync(
        `git -C ${shellQuote(repo.local_path)} branch -d ${shellQuote(branchName)}`
      );
    } catch {
      // Branch may have unmerged commits — leave it
    }
  }
}
