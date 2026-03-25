/**
 * PR status poller: Periodically checks GitHub for PR status updates.
 *
 * Polls all open PRs every 60 seconds and updates their status when merged or closed.
 * Also checks merge conflicts and CI status to transition issues appropriately.
 */
import { eventBus } from "../events/bus.js";
import {
  getGitHubAccount,
  getGitHubAccountByUsername,
} from "../db/repositories/github-accounts.js";
import { getIssue, updateIssue } from "../db/repositories/issues.js";
import {
  listOpenPRsWithContext,
  updateIssuePR,
} from "../db/repositories/issue-prs.js";
import { logger } from "../logger.js";
import {
  IssueStatus,
  PRStatus,
  PR_RELATED_ISSUE_STATUSES,
} from "../constants/statuses.js";
import type { IssueStatusValue, PRStatusValue } from "../constants/statuses.js";

const POLL_INTERVAL = 60_000; // 60 seconds

let pollInterval: ReturnType<typeof setInterval> | null = null;

interface GitHubPRResponse {
  state: "open" | "closed";
  merged: boolean;
  mergeable: boolean | null;
  head: { sha: string };
}

interface GitHubCheckRun {
  status: "queued" | "in_progress" | "completed";
  conclusion:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "skipped"
    | "timed_out"
    | "action_required"
    | null;
}

interface GitHubCheckRunsResponse {
  total_count: number;
  check_runs: GitHubCheckRun[];
}

interface GitHubStatusResponse {
  state: "success" | "failure" | "pending";
  total_count: number;
}

const GITHUB_HEADERS = {
  Accept: "application/vnd.github.v3+json",
  "User-Agent": "crewdeck",
};

/** Generic GitHub API fetch with error handling. */
async function githubFetch<T>(
  url: string,
  token: string,
  context: string,
): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` },
    });

    if (response.status === 401 || response.status === 403) {
      logger.warn(
        { url, status: response.status },
        `${context}: token invalid or expired`,
      );
      return null;
    }

    if (response.status === 404) {
      logger.warn({ url }, `${context}: not found`);
      return null;
    }

    if (!response.ok) {
      logger.warn(
        { url, status: response.status },
        `${context}: API request failed`,
      );
      return null;
    }

    return (await response.json()) as T;
  } catch (err) {
    logger.error({ err, url }, `${context}: fetch failed`);
    return null;
  }
}

/** Fetch PR status from GitHub API. */
async function fetchPRStatus(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<GitHubPRResponse | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
  return githubFetch<GitHubPRResponse>(url, token, "PR status");
}

/** Fetch check runs for a commit (modern CI). */
async function fetchCheckRuns(
  owner: string,
  repo: string,
  ref: string,
  token: string,
): Promise<GitHubCheckRunsResponse | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${ref}/check-runs`;
  return githubFetch<GitHubCheckRunsResponse>(url, token, "Check runs");
}

/** Fetch combined status for a commit (legacy CI). */
async function fetchCommitStatus(
  owner: string,
  repo: string,
  ref: string,
  token: string,
): Promise<GitHubStatusResponse | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${ref}/status`;
  return githubFetch<GitHubStatusResponse>(url, token, "Commit status");
}

/** Map GitHub PR state to our internal status. */
function mapPRStatus(pr: GitHubPRResponse): PRStatusValue {
  if (pr.merged) return PRStatus.MERGED;
  if (pr.state === "closed") return PRStatus.CLOSED;
  return PRStatus.OPEN;
}

type CheckResult = "pass" | "fail" | "pending";

/** Analyze check runs to determine overall status. */
function analyzeCheckRuns(checkRuns: GitHubCheckRunsResponse): CheckResult {
  if (checkRuns.total_count === 0) return "pass"; // No checks configured

  const runs = checkRuns.check_runs;
  const hasIncomplete = runs.some((r) => r.status !== "completed");
  if (hasIncomplete) return "pending";

  const hasFailed = runs.some(
    (r) =>
      r.conclusion === "failure" ||
      r.conclusion === "cancelled" ||
      r.conclusion === "timed_out",
  );
  return hasFailed ? "fail" : "pass";
}

/** Analyze legacy status to determine overall status. */
function analyzeCommitStatus(status: GitHubStatusResponse): CheckResult {
  if (status.state === "success") return "pass";
  if (status.state === "failure") return "fail";
  // No legacy statuses configured — nothing is blocking
  if (status.state === "pending" && status.total_count === 0) return "pass";
  return "pending";
}

/** Combine check runs and legacy status results. */
function combineCheckResults(
  checkRuns: CheckResult,
  legacy: CheckResult,
): CheckResult {
  if (checkRuns === "fail" || legacy === "fail") return "fail";
  if (checkRuns === "pending" || legacy === "pending") return "pending";
  return "pass";
}

/** Determine issue status based on PR state, mergeability, and CI status. */
function determineIssueStatus(
  mergeable: boolean | null,
  ciStatus: CheckResult,
): string {
  // Merge conflict takes priority
  if (mergeable === false) return IssueStatus.PR_CONFLICT;

  // CI failed
  if (ciStatus === "fail") return IssueStatus.PR_FAILED_ACTIONS;

  // All good - ready to merge
  if (mergeable === true && ciStatus === "pass")
    return IssueStatus.PR_READY_TO_MERGE;

  // Still pending (mergeable null or checks pending) - regress to pr_created
  return IssueStatus.PR_CREATED;
}

/** Poll all open PRs and update their status. */
export async function pollPRs(): Promise<void> {
  const openPRs = listOpenPRsWithContext();
  if (openPRs.length === 0) return;

  // Resolve OAuth token for each PR: project account first, then fallback to repo owner username
  const tokenCache = new Map<string, string | null>();

  function resolveToken(pr: (typeof openPRs)[number]): string | null {
    const key = pr.github_account_id ?? `owner:${pr.repo_owner}`;
    if (tokenCache.has(key)) return tokenCache.get(key)!;

    let token: string | null = null;
    if (pr.github_account_id) {
      token = getGitHubAccount(pr.github_account_id)?.gh_token ?? null;
    }
    if (!token) {
      token = getGitHubAccountByUsername(pr.repo_owner)?.gh_token ?? null;
    }
    tokenCache.set(key, token);
    return token;
  }

  // Process PRs sequentially to respect rate limits
  for (const pr of openPRs) {
    const token = resolveToken(pr);
    if (!token) {
      logger.warn(
        {
          pr_number: pr.pr_number,
          repo_owner: pr.repo_owner,
          project_id: pr.project_id,
        },
        "Skipping PR: no GitHub token (project has no account and no account matches repo owner)",
      );
      continue;
    }

    const ghPR = await fetchPRStatus(
      pr.repo_owner,
      pr.repo_name,
      pr.pr_number,
      token,
    );

    if (!ghPR) continue;

    const newPRStatus = mapPRStatus(ghPR);

    // Update PR status if changed
    if (newPRStatus !== pr.status) {
      updateIssuePR(pr.id, { status: newPRStatus });

      logger.info(
        {
          pr_id: pr.id,
          pr_number: pr.pr_number,
          from: pr.status,
          to: newPRStatus,
        },
        "PR status changed",
      );

      eventBus.emit("pr.status_changed", {
        pr_id: pr.id,
        project_id: pr.project_id,
        from: pr.status,
        to: newPRStatus,
      });
    }

    // Auto-transition issue to done if PR is merged (unless already done)
    if (newPRStatus === PRStatus.MERGED) {
      const issue = getIssue(pr.issue_id);
      if (issue && issue.status !== IssueStatus.DONE) {
        updateIssue(pr.issue_id, { status: IssueStatus.DONE });

        logger.info(
          { issue_id: pr.issue_id, pr_number: pr.pr_number },
          "Issue auto-transitioned to done (PR merged)",
        );

        eventBus.emit("issue.status_changed", {
          issue_id: pr.issue_id,
          project_id: pr.project_id,
          from: issue.status,
          to: IssueStatus.DONE,
        });
      }
      continue; // No need to check CI for merged PRs
    }

    // For open PRs, check CI status and mergeability
    if (newPRStatus === PRStatus.OPEN) {
      const issue = getIssue(pr.issue_id);
      if (
        !issue ||
        !PR_RELATED_ISSUE_STATUSES.has(issue.status as IssueStatusValue)
      )
        continue;

      // Fetch CI status (both modern check runs and legacy status)
      const [checkRuns, commitStatus] = await Promise.all([
        fetchCheckRuns(pr.repo_owner, pr.repo_name, ghPR.head.sha, token),
        fetchCommitStatus(pr.repo_owner, pr.repo_name, ghPR.head.sha, token),
      ]);

      const checkRunsResult = checkRuns
        ? analyzeCheckRuns(checkRuns)
        : "pending";
      const legacyResult = commitStatus
        ? analyzeCommitStatus(commitStatus)
        : "pending";
      const ciStatus = combineCheckResults(checkRunsResult, legacyResult);

      const newIssueStatus = determineIssueStatus(ghPR.mergeable, ciStatus);

      if (newIssueStatus !== issue.status) {
        updateIssue(pr.issue_id, { status: newIssueStatus });

        logger.info(
          {
            issue_id: pr.issue_id,
            pr_number: pr.pr_number,
            from: issue.status,
            to: newIssueStatus,
            mergeable: ghPR.mergeable,
            ciStatus,
          },
          "Issue status updated based on PR checks",
        );

        eventBus.emit("issue.status_changed", {
          issue_id: pr.issue_id,
          project_id: pr.project_id,
          from: issue.status,
          to: newIssueStatus,
        });
      }
    }
  }
}

export function startPRPoller(): void {
  if (pollInterval) return;

  // Run immediately on start, then every POLL_INTERVAL
  pollPRs().catch((err) => {
    logger.error({ err }, "Initial PR poll failed");
  });

  pollInterval = setInterval(() => {
    pollPRs().catch((err) => {
      logger.error({ err }, "PR poll failed");
    });
  }, POLL_INTERVAL);

  logger.info({ interval: POLL_INTERVAL }, "PR poller started");
}

export function stopPRPoller(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    logger.info("PR poller stopped");
  }
}
