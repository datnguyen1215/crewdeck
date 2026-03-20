/**
 * PR status poller: Periodically checks GitHub for PR status updates.
 *
 * Polls all open PRs every 60 seconds and updates their status when merged or closed.
 * Auto-transitions issues from pr_created to done when PRs are merged.
 */
import { eventBus } from "../events/bus.js";
import { getGitHubAccount } from "../db/repositories/github-accounts.js";
import { getIssue, updateIssue } from "../db/repositories/issues.js";
import {
  listOpenPRsWithContext,
  updateIssuePR,
} from "../db/repositories/issue-prs.js";
import { logger } from "../logger.js";

const POLL_INTERVAL = 60_000; // 60 seconds

let pollInterval: ReturnType<typeof setInterval> | null = null;

interface GitHubPRResponse {
  state: "open" | "closed";
  merged: boolean;
}

/** Fetch PR status from GitHub API. */
async function fetchPRStatus(
  owner: string,
  repo: string,
  prNumber: number,
  token: string
): Promise<GitHubPRResponse | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "crewdeck",
      },
    });

    if (response.status === 401 || response.status === 403) {
      logger.warn(
        { owner, repo, prNumber, status: response.status },
        "GitHub token invalid or expired"
      );
      return null;
    }

    if (response.status === 404) {
      logger.warn({ owner, repo, prNumber }, "PR not found on GitHub");
      return null;
    }

    if (!response.ok) {
      logger.warn(
        { owner, repo, prNumber, status: response.status },
        "GitHub API request failed"
      );
      return null;
    }

    return (await response.json()) as GitHubPRResponse;
  } catch (err) {
    logger.error({ err, owner, repo, prNumber }, "Failed to fetch PR status from GitHub");
    return null;
  }
}

/** Map GitHub PR state to our internal status. */
function mapPRStatus(pr: GitHubPRResponse): "open" | "merged" | "closed" {
  if (pr.merged) return "merged";
  if (pr.state === "closed") return "closed";
  return "open";
}

/** Poll all open PRs and update their status. */
async function pollPRs(): Promise<void> {
  const openPRs = listOpenPRsWithContext();
  if (openPRs.length === 0) return;

  // Group PRs by github_account_id to batch requests by token
  const byAccount = new Map<string, typeof openPRs>();
  for (const pr of openPRs) {
    if (!pr.github_account_id) continue;
    if (!byAccount.has(pr.github_account_id)) {
      byAccount.set(pr.github_account_id, []);
    }
    byAccount.get(pr.github_account_id)!.push(pr);
  }

  for (const [accountId, prs] of byAccount) {
    const account = getGitHubAccount(accountId);
    if (!account?.oauth_token) {
      logger.debug({ accountId }, "Skipping PRs: no OAuth token");
      continue;
    }

    // Process PRs sequentially to respect rate limits
    for (const pr of prs) {
      const ghPR = await fetchPRStatus(
        pr.repo_owner,
        pr.repo_name,
        pr.pr_number,
        account.oauth_token
      );

      if (!ghPR) continue;

      const newStatus = mapPRStatus(ghPR);
      if (newStatus === pr.status) continue;

      // Update PR status
      updateIssuePR(pr.id, { status: newStatus });

      logger.info(
        { pr_id: pr.id, pr_number: pr.pr_number, from: pr.status, to: newStatus },
        "PR status changed"
      );

      eventBus.emit("pr.status_changed", {
        pr_id: pr.id,
        project_id: pr.project_id,
        from: pr.status,
        to: newStatus,
      });

      // Auto-transition issue to done if PR is merged and issue is in pr_created status
      if (newStatus === "merged") {
        const issue = getIssue(pr.issue_id);
        if (issue?.status === "pr_created") {
          updateIssue(pr.issue_id, { status: "done" });

          logger.info(
            { issue_id: pr.issue_id, pr_number: pr.pr_number },
            "Issue auto-transitioned to done (PR merged)"
          );

          eventBus.emit("issue.status_changed", {
            issue_id: pr.issue_id,
            project_id: pr.project_id,
            from: "pr_created",
            to: "done",
          });
        }
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
