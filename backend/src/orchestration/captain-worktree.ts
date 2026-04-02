/**
 * Captain Worktree Manager
 *
 * Creates and manages git worktrees for captain chat sessions.
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "../logger.js";
import { getProject } from "../db/repositories/projects.js";
import { listRepos } from "../db/repositories/repos.js";
import { getVCSAccount } from "../db/repositories/vcs-accounts.js";
import { toContainerPath } from "../utils/paths.js";
import { shellQuote } from "./shell.js";
import { slugify } from "./worktree.js";
import { createGitSshEnv, cleanupSshKey } from "../utils/git-auth.js";

const execAsync = promisify(exec);

/**
 * Set up GitHub authentication environment variables.
 */
export const setupGitHubAuth = async (
  projectId: string,
  env: Record<string, string>,
): Promise<string | undefined> => {
  const project = getProject(projectId);
  if (!project?.vcs_account_id) return undefined;

  const account = getVCSAccount(project.vcs_account_id);
  if (!account) return undefined;

  env.GH_TOKEN = account.token;
  const ssh = createGitSshEnv(account.ssh_private_key);
  Object.assign(env, ssh.env);
  return ssh.keyPath;
};

/**
 * Create a worktree for captain chat session.
 * Similar to issue worktrees but long-lived and named differently.
 */
export async function createCaptainWorktree(
  projectId: string,
  sshPrivateKey?: string,
): Promise<string | null> {
  const repos = listRepos(projectId);
  if (repos.length === 0) {
    logger.warn(
      { projectId },
      "No repos found for project, cannot create worktree",
    );
    return null;
  }

  const repo = repos[0];
  const branchName = "captain";
  const project = getProject(projectId);
  const projectSlug = project ? slugify(project.name) : projectId;
  const repoPath = toContainerPath(repo.local_path);
  const worktreePath = join(tmpdir(), "crewdeck", projectSlug, "captain");

  // Try to fetch latest from origin
  let fetchSucceeded = false;
  const ssh = sshPrivateKey ? createGitSshEnv(sshPrivateKey) : null;
  try {
    const fetchEnv = { ...process.env, ...ssh?.env, GIT_TERMINAL_PROMPT: "0" };
    await execAsync(`git -C ${shellQuote(repoPath)} fetch origin`, {
      env: fetchEnv,
    });
    fetchSucceeded = true;
  } catch (err) {
    logger.warn(
      { projectId, err },
      "Failed to fetch from origin for captain worktree",
    );
  } finally {
    if (ssh) cleanupSshKey(ssh.keyPath);
  }

  const startPoint = fetchSucceeded
    ? `origin/${repo.default_branch}`
    : repo.default_branch;

  // Prune stale worktree entries
  await execAsync(`git -C ${shellQuote(repoPath)} worktree prune`);

  // Check if worktree already exists and is registered
  let worktreeExists = false;
  try {
    const { stdout } = await execAsync(
      `git -C ${shellQuote(repoPath)} worktree list --porcelain`,
    );
    const lines = stdout.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("worktree ") && lines[i].includes(worktreePath)) {
        worktreeExists = true;
        break;
      }
    }
  } catch {
    // worktree list failed, assume doesn't exist
  }

  if (worktreeExists) {
    // Worktree already registered, reuse it
    logger.info(
      { projectId, worktreePath },
      "Reusing existing captain worktree",
    );

    // Rebase onto latest base branch
    if (fetchSucceeded) {
      try {
        await execAsync(
          `git -C ${shellQuote(worktreePath)} rebase ${shellQuote(startPoint)}`,
        );
      } catch (err) {
        // Abort rebase if it fails
        await execAsync(
          `git -C ${shellQuote(worktreePath)} rebase --abort`,
        ).catch(() => {});
        logger.warn({ projectId, err }, "Failed to rebase captain worktree");
      }
    }
  } else {
    // Worktree not registered, need to add it
    // Check if branch exists
    let branchExists = false;
    try {
      await execAsync(
        `git -C ${shellQuote(repoPath)} rev-parse --verify ${shellQuote(branchName)}`,
      );
      branchExists = true;
    } catch {
      // Branch doesn't exist
    }

    if (branchExists) {
      // Reuse existing branch
      await execAsync(
        `git -C ${shellQuote(repoPath)} worktree add ${shellQuote(worktreePath)} ${shellQuote(branchName)}`,
      );

      // Rebase onto latest base branch
      if (fetchSucceeded) {
        try {
          await execAsync(
            `git -C ${shellQuote(worktreePath)} rebase ${shellQuote(startPoint)}`,
          );
        } catch (err) {
          // Abort rebase if it fails
          await execAsync(
            `git -C ${shellQuote(worktreePath)} rebase --abort`,
          ).catch(() => {});
          logger.warn({ projectId, err }, "Failed to rebase captain worktree");
        }
      }
    } else {
      // Create new branch
      await execAsync(
        `git -C ${shellQuote(repoPath)} worktree add -b ${shellQuote(branchName)} ${shellQuote(worktreePath)} ${shellQuote(startPoint)}`,
      );
    }
  }

  // Inject Claude Code settings to disable AI attribution
  const claudeDir = join(worktreePath, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(
    join(claudeDir, "settings.json"),
    JSON.stringify({ attribution: { commit: "", pr: "" } }),
  );

  logger.info({ projectId, worktreePath }, "Captain worktree created");
  return worktreePath;
}
