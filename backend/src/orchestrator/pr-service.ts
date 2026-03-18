import { exec } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger.js";
import type { EventBus } from "../events/bus.js";
import { getProject } from "../db/repositories/projects.js";
import { getIssue, updateIssue } from "../db/repositories/issues.js";
import { listRepos } from "../db/repositories/repos.js";
import { getGitHubAccount } from "../db/repositories/github-accounts.js";
import { createIssuePR } from "../db/repositories/issue-prs.js";
import { createComment } from "../db/repositories/comments.js";
import { shellQuote } from "../agent/shell.js";
import { toContainerPath } from "../utils/paths.js";

const execAsync = promisify(exec);

/** Extract PR number from a GitHub PR URL (e.g. https://github.com/owner/repo/pull/123 → 123). */
function parsePrNumber(url: string): number {
  const match = url.match(/\/pull\/(\d+)$/);
  if (!match) {
    throw new Error(`Could not parse PR number from URL: ${url}`);
  }
  return parseInt(match[1], 10);
}

/** Configure git credentials for a worktree so `git push` and `gh` work with the project's OAuth token. */
function writeAskpassScript(token: string): string {
  const askpass = path.join(
    os.tmpdir(),
    `crewdeck-askpass-${crypto.randomUUID()}.sh`,
  );
  fs.writeFileSync(
    askpass,
    `#!/bin/sh\nprintf '%s\\n' '${token.replace(/'/g, "'\\''")}';\n`,
    { mode: 0o700 },
  );
  return askpass;
}

/** Push the worktree branch and create a GitHub PR. */
export async function executeCreatePR(
  projectId: string,
  issueId: string,
  bus: EventBus,
): Promise<void> {
  const issue = getIssue(issueId);
  if (!issue) {
    logger.warn({ issueId }, "create_pr: issue not found");
    return;
  }
  if (issue.project_id !== projectId) {
    logger.warn(
      { issueId, projectId },
      "create_pr: issue does not belong to project",
    );
    return;
  }
  if (issue.status !== "ready") {
    logger.warn(
      { issueId, status: issue.status },
      "create_pr: issue is not in ready state",
    );
    return;
  }
  if (!issue.worktree_path || !issue.branch_name || !issue.base_branch) {
    logger.warn({ issueId }, "create_pr: issue missing worktree/branch info");
    return;
  }

  const project = getProject(projectId);
  if (!project) return;

  const repos = listRepos(projectId);
  const repo = repos.length > 0 ? repos[0] : null;
  if (!repo) {
    logger.warn({ projectId }, "create_pr: no repo configured");
    return;
  }

  const ghAccount = project.github_account_id
    ? getGitHubAccount(project.github_account_id)
    : null;
  const token = ghAccount?.oauth_token;

  const worktreePath = issue.worktree_path;
  const branchName = issue.branch_name;
  const baseBranch = issue.base_branch;

  // Push the branch
  let askpass: string | undefined;
  try {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      GIT_TERMINAL_PROMPT: "0",
    };
    if (token) {
      askpass = writeAskpassScript(token);
      env.GIT_ASKPASS = askpass;
    }

    await execAsync(
      `git -C ${shellQuote(worktreePath)} push -u origin ${shellQuote(branchName)}`,
      { env },
    );
    logger.info({ branchName }, "create_pr: branch pushed");
  } catch (err) {
    const stderr =
      err instanceof Error && "stderr" in err
        ? String((err as any).stderr)
        : "";
    // Strip URLs that may contain credentials
    const safe = (
      stderr || (err instanceof Error ? err.message : "unknown")
    ).replace(/https?:\/\/[^\s]+/g, "<url>");
    logger.error({ err: safe, branchName }, "create_pr: failed to push branch");

    const comment = createComment(issueId, {
      content: `Failed to push branch \`${branchName}\`: ${safe}`,
      author_type: "orchestrator",
    });
    bus.emit("comment.added", { comment, project_id: projectId });
    return;
  } finally {
    if (askpass)
      try {
        fs.unlinkSync(askpass);
      } catch {}
  }

  // Create the PR via gh CLI
  // gh pr create does not support --json; it outputs the PR URL to stdout on success
  let prUrl: string;
  let prNumber: number;
  try {
    const ghEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
    };
    if (token) ghEnv.GH_TOKEN = token;

    const repoPath = toContainerPath(repo.local_path);
    const { stdout } = await execAsync(
      `gh pr create --repo ${shellQuote(`${repo.owner}/${repo.name}`)} --head ${shellQuote(branchName)} --base ${shellQuote(baseBranch)} --title ${shellQuote(issue.title)} --body ${shellQuote(`Resolves crewdeck issue ${issue.id}.\n\n${issue.description}`)}`,
      { env: ghEnv, cwd: repoPath },
    );

    prUrl = stdout.trim();
    if (!prUrl.startsWith("https://")) {
      throw new Error(`Unexpected gh pr create output: ${stdout}`);
    }
    prNumber = parsePrNumber(prUrl);
    logger.info({ prUrl, prNumber }, "create_pr: PR created");
  } catch (err) {
    const stderr =
      err instanceof Error && "stderr" in err
        ? String((err as any).stderr)
        : "";
    const safe = (
      stderr || (err instanceof Error ? err.message : "unknown")
    ).replace(/https?:\/\/[^\s]+/g, "<url>");
    logger.error({ err: safe }, "create_pr: failed to create PR");

    const comment = createComment(issueId, {
      content: `Branch pushed but failed to create PR: ${safe}`,
      author_type: "orchestrator",
    });
    bus.emit("comment.added", { comment, project_id: projectId });
    return;
  }

  // Record in DB and update issue status
  const issuePR = createIssuePR({
    issue_id: issueId,
    repo_id: repo.id,
    pr_number: prNumber,
    pr_url: prUrl,
  });

  updateIssue(issueId, { status: "pr_created" });

  bus.emit("pr.created", { issue_pr: issuePR, project_id: projectId });
  bus.emit("issue.status_changed", {
    issue_id: issueId,
    project_id: projectId,
    from: "ready",
    to: "pr_created",
  });

  const comment = createComment(issueId, {
    content: `Pull request created: ${prUrl}`,
    author_type: "orchestrator",
  });
  bus.emit("comment.added", { comment, project_id: projectId });
}
