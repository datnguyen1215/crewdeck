import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { updateIssue } from "../db/repositories/issues.js";
import { getProject } from "../db/repositories/projects.js";
import { shellQuote } from "./shell.js";
import { toContainerPath } from "../utils/paths.js";
import { createGitSshEnv, cleanupSshKey } from "../utils/git-auth.js";
import type { Repo, Issue } from "../types/entities.js";
import { logger } from "../logger.js";

const execAsync = promisify(exec);

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
}

type PrefixMatch = { prefix: string; leadingKeyword: string | null };

const PREFIX_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:fix(?:e[sd])?|bug(?:gy|s)?|error[s]?|crash(?:e[sd])?|broken)\b/, "fix"],
  [/\b(?:refactor(?:s|ed|ing)?|cleanup|reorganize(?:s|d)?|reorganise(?:s|d)?)\b/, "refactor"],
  [/\b(?:update[sd]?|change[sd]?|modif(?:y|ied|ies|ications?))\b/, "update"],
  [/\b(?:remove[sd]?|delete[sd]?|drop(?:s|ped|ping)?)\b/, "chore"],
];

function inferPrefix(title: string): PrefixMatch {
  for (const [pattern, prefix] of PREFIX_PATTERNS) {
    const match = pattern.exec(title.toLowerCase());
    if (match) {
      const wordStart = title.toLowerCase().indexOf(match[0]);
      const leadingKeyword = wordStart === 0 ? match[0] : null;
      return { prefix, leadingKeyword };
    }
  }
  return { prefix: "feature", leadingKeyword: null };
}

export function generateBranchName(title: string, issueId: string): string {
  const { prefix, leadingKeyword } = inferPrefix(title);
  // Strip the actual matched leading keyword from the slug
  const stripped = leadingKeyword
    ? title.slice(leadingKeyword.length).replace(/^\s+/, "")
    : title;
  const slug = slugify(stripped || title);
  const shortHash = issueId.slice(0, 4);
  return `${prefix}/${slug}-${shortHash}`;
}

export async function createWorktree(
  repo: Repo,
  issue: Issue,
  baseBranch: string,
  sshPrivateKey?: string,
): Promise<{ path: string; branchName: string }> {
  const branchName = generateBranchName(issue.title, issue.id);
  const project = getProject(issue.project_id);
  const projectSlug = project ? slugify(project.name) : issue.project_id;
  const repoPath = toContainerPath(repo.local_path);
  const worktreePath = join(tmpdir(), "crewdeck", projectSlug, branchName);

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
