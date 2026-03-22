/**
 * Admiral: Auto-pilot orchestrator that manages the project automatically.
 *
 * Responsibilities (in priority order):
 * 1. Merge manager: Merge PRs in `pr_ready_to_merge` status
 * 2. Fix mode: Dispatch Captain to fix `pr_conflict` or `pr_failed_actions` issues
 * 3. Work starter: Start new work on open unassigned issues when capacity allows
 *
 * Triggers:
 * - Reactive: Subscribes to `issue.status_changed` events
 * - Proactive: Polls every 60 seconds as a safety net
 */
import { eventBus } from "../events/bus.js";
import { logger } from "../logger.js";
import { db } from "../db/index.js";
import { getProject, listProjects } from "../db/repositories/projects.js";
import { listIssues, getIssue, updateIssue } from "../db/repositories/issues.js";
import { getGitHubAccount } from "../db/repositories/github-accounts.js";
import { listIssuePRs, updateIssuePR } from "../db/repositories/issue-prs.js";
import { createComment } from "../db/repositories/comments.js";
import { pollPRs } from "../pr/poller.js";
import { getCrewMember } from "./crew.js";
import { spawnAgent, postSystemComment } from "./spawner.js";
import { hasActiveAgentProcess } from "./processes.js";
import type { Issue, Project, IssuePR } from "../types/entities.js";

const POLL_INTERVAL = 60_000; // 60 seconds

let pollInterval: ReturnType<typeof setInterval> | null = null;

const GITHUB_HEADERS = {
  Accept: "application/vnd.github.v3+json",
  "User-Agent": "crewdeck",
};

interface PRWithContext {
  issue: Issue;
  issuePR: IssuePR;
  repoOwner: string;
  repoName: string;
  token: string;
}

/**
 * Get repo info for an issue PR.
 */
function getRepoInfo(repoId: string): { owner: string; name: string } | null {
  const row = db
    .prepare("SELECT owner, name FROM Repo WHERE id = ?")
    .get(repoId) as { owner: string; name: string } | undefined;
  return row ?? null;
}

/**
 * Merge a PR via GitHub API.
 */
async function mergePR(
  owner: string,
  repo: string,
  prNumber: number,
  token: string
): Promise<{ success: boolean; message: string }> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/merge`;

  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        ...GITHUB_HEADERS,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        merge_method: "squash",
      }),
    });

    if (response.ok) {
      return { success: true, message: "PR merged successfully" };
    }

    const body = await response.json().catch(() => ({}));
    const message = (body as any).message || `HTTP ${response.status}`;

    if (response.status === 405) {
      return { success: false, message: `PR not mergeable: ${message}` };
    }
    if (response.status === 409) {
      return { success: false, message: `Merge conflict: ${message}` };
    }

    return { success: false, message: `Merge failed: ${message}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, message: `Merge request failed: ${message}` };
  }
}

/**
 * Get all PRs ready to merge for admiral-enabled projects.
 */
function getPRsReadyToMerge(): PRWithContext[] {
  const results: PRWithContext[] = [];

  const projects = listProjects().filter((p) => p.admiral_enabled);

  for (const project of projects) {
    if (!project.github_account_id) continue;

    const account = getGitHubAccount(project.github_account_id);
    if (!account) continue;

    const issues = listIssues(project.id, { status: ["pr_ready_to_merge"] });

    for (const issue of issues) {
      const prs = listIssuePRs(issue.id);
      const openPR = prs.find((pr) => pr.status === "open");
      if (!openPR) continue;

      const repoInfo = getRepoInfo(openPR.repo_id);
      if (!repoInfo) continue;

      results.push({
        issue,
        issuePR: openPR,
        repoOwner: repoInfo.owner,
        repoName: repoInfo.name,
        token: account.oauth_token,
      });
    }
  }

  return results;
}

/**
 * Get issues that need fixing (conflict or failed actions).
 */
function getIssuesNeedingFix(): { issue: Issue; project: Project }[] {
  const results: { issue: Issue; project: Project }[] = [];

  const projects = listProjects().filter((p) => p.admiral_enabled);

  for (const project of projects) {
    const issues = listIssues(project.id, {
      status: ["pr_conflict", "pr_failed_actions"],
    });

    for (const issue of issues) {
      results.push({ issue, project });
    }
  }

  return results;
}

/**
 * Get open unassigned issues that can be started.
 */
function getOpenUnassignedIssues(): { issue: Issue; project: Project }[] {
  const results: { issue: Issue; project: Project }[] = [];

  const projects = listProjects().filter((p) => p.admiral_enabled);

  for (const project of projects) {
    const openIssues = listIssues(project.id, { status: ["open"] });

    // Count active issues (in_progress + pr_* statuses except done)
    const activeIssues = listIssues(project.id, {
      status: [
        "in_progress",
        "pr_created",
        "pr_conflict",
        "pr_failed_actions",
        "pr_ready_to_merge",
      ],
    });

    // Check capacity
    if (activeIssues.length >= project.max_concurrency) continue;

    for (const issue of openIssues) {
      results.push({ issue, project });
    }
  }

  return results;
}

/**
 * Priority 1: Merge PRs that are ready.
 * Merges one at a time, polling for status updates after each merge.
 */
async function handleMergeManager(): Promise<boolean> {
  const prsToMerge = getPRsReadyToMerge();
  if (prsToMerge.length === 0) return false;

  logger.info({ count: prsToMerge.length }, "Admiral: PRs ready to merge");

  // Merge one PR at a time
  for (const pr of prsToMerge) {
    logger.info(
      {
        issueId: pr.issue.id,
        prNumber: pr.issuePR.pr_number,
        repo: `${pr.repoOwner}/${pr.repoName}`,
      },
      "Admiral: Merging PR"
    );

    const result = await mergePR(
      pr.repoOwner,
      pr.repoName,
      pr.issuePR.pr_number,
      pr.token
    );

    if (result.success) {
      // Update PR status to merged
      updateIssuePR(pr.issuePR.id, { status: "merged" });

      // Update issue status to done
      updateIssue(pr.issue.id, { status: "done" });

      // Post comment
      const comment = createComment(pr.issue.id, {
        content: `PR #${pr.issuePR.pr_number} merged by Admiral.`,
        author_type: "system",
      });
      eventBus.emit("comment.added", {
        comment,
        project_id: pr.issue.project_id,
      });

      eventBus.emit("issue.status_changed", {
        issue_id: pr.issue.id,
        project_id: pr.issue.project_id,
        from: "pr_ready_to_merge",
        to: "done",
      });

      logger.info(
        { issueId: pr.issue.id, prNumber: pr.issuePR.pr_number },
        "Admiral: PR merged successfully"
      );
    } else {
      logger.warn(
        {
          issueId: pr.issue.id,
          prNumber: pr.issuePR.pr_number,
          message: result.message,
        },
        "Admiral: Failed to merge PR"
      );

      postSystemComment(
        pr.issue.id,
        pr.issue.project_id,
        `Admiral failed to merge PR #${pr.issuePR.pr_number}: ${result.message}`
      );
    }

    // Poll PR statuses after each merge to update any affected PRs
    await pollPRs();
  }

  return true;
}

/**
 * Priority 2: Dispatch Captain to fix issues with conflicts or failed actions.
 */
async function handleFixMode(): Promise<boolean> {
  const issuesNeedingFix = getIssuesNeedingFix();
  if (issuesNeedingFix.length === 0) return false;

  logger.info(
    { count: issuesNeedingFix.length },
    "Admiral: Issues needing fix"
  );

  const captain = getCrewMember("captain");
  if (!captain) {
    logger.error("Admiral: Captain agent not found");
    return false;
  }

  for (const { issue, project } of issuesNeedingFix) {
    // Skip if captain is already running for this issue
    if (hasActiveAgentProcess(captain.id, issue.id)) {
      logger.debug(
        { issueId: issue.id },
        "Admiral: Captain already running for this issue"
      );
      continue;
    }

    const fixType =
      issue.status === "pr_conflict" ? "merge conflicts" : "failed CI actions";

    logger.info(
      { issueId: issue.id, status: issue.status },
      `Admiral: Dispatching Captain to fix ${fixType}`
    );

    // Post a comment explaining what Admiral is doing
    const comment = createComment(issue.id, {
      content: `/dispatch captain\n\nAdmiral: Fix ${fixType} on this PR. Push fixes to the existing branch.`,
      author_type: "system",
      author_id: "admiral",
    });
    eventBus.emit("comment.added", { comment, project_id: project.id });
  }

  return true;
}

/**
 * Priority 3: Start work on open unassigned issues.
 */
async function handleWorkStarter(): Promise<boolean> {
  const openIssues = getOpenUnassignedIssues();
  if (openIssues.length === 0) return false;

  logger.info(
    { count: openIssues.length },
    "Admiral: Open issues available for work"
  );

  const captain = getCrewMember("captain");
  if (!captain) {
    logger.error("Admiral: Captain agent not found");
    return false;
  }

  // Start work on the first available issue (simple approach)
  // In the future, could use LLM to analyze dependencies
  for (const { issue, project } of openIssues) {
    // Skip if captain is already running for this issue
    if (hasActiveAgentProcess(captain.id, issue.id)) {
      logger.debug(
        { issueId: issue.id },
        "Admiral: Captain already running for this issue"
      );
      continue;
    }

    logger.info(
      { issueId: issue.id, title: issue.title },
      "Admiral: Starting work on issue"
    );

    // Post a comment to trigger captain dispatch
    const comment = createComment(issue.id, {
      content: `/dispatch captain\n\nAdmiral: Start work on this issue.`,
      author_type: "system",
      author_id: "admiral",
    });
    eventBus.emit("comment.added", { comment, project_id: project.id });

    // Only start one issue per cycle to avoid overwhelming the system
    return true;
  }

  return false;
}

/**
 * Main Admiral cycle - runs through all responsibilities in priority order.
 */
async function runAdmiralCycle(): Promise<void> {
  try {
    // Priority 1: Merge ready PRs
    const merged = await handleMergeManager();
    if (merged) return; // If we merged something, wait for next cycle

    // Priority 2: Fix broken PRs
    const fixing = await handleFixMode();
    if (fixing) return;

    // Priority 3: Start new work
    await handleWorkStarter();
  } catch (err) {
    logger.error({ err }, "Admiral cycle failed");
  }
}

/**
 * Handle status change events reactively.
 */
function handleStatusChange(event: {
  issue_id: string;
  project_id: string;
  from: string;
  to: string;
}): void {
  const { to } = event;

  // Only react to statuses we care about
  const relevantStatuses = [
    "done",
    "pr_ready_to_merge",
    "pr_conflict",
    "pr_failed_actions",
  ];

  if (!relevantStatuses.includes(to)) return;

  // Check if project has admiral enabled
  const project = getProject(event.project_id);
  if (!project?.admiral_enabled) return;

  logger.info(
    { issueId: event.issue_id, from: event.from, to: event.to },
    "Admiral: Reacting to status change"
  );

  // Run the cycle (async, don't block the event handler)
  runAdmiralCycle().catch((err) => {
    logger.error({ err }, "Admiral reactive cycle failed");
  });
}

/**
 * Initialize the Admiral background service.
 */
export function initAdmiral(): void {
  // Subscribe to status change events (reactive trigger)
  eventBus.on("issue.status_changed", handleStatusChange);

  // Start polling loop (proactive trigger)
  pollInterval = setInterval(() => {
    runAdmiralCycle().catch((err) => {
      logger.error({ err }, "Admiral poll cycle failed");
    });
  }, POLL_INTERVAL);

  // Run initial cycle
  runAdmiralCycle().catch((err) => {
    logger.error({ err }, "Admiral initial cycle failed");
  });

  logger.info({ interval: POLL_INTERVAL }, "Admiral initialized");
}

/**
 * Shutdown the Admiral service.
 */
export function shutdownAdmiral(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  eventBus.off("issue.status_changed", handleStatusChange);

  logger.info("Admiral shutdown");
}
