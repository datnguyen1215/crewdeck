/**
 * PR status poller: Periodically checks VCS providers for PR status updates.
 *
 * Polls all open PRs every 60 seconds and updates their status when merged or closed.
 * Also checks merge conflicts and CI status to transition issues appropriately.
 */
import { eventBus } from "../events/bus.js";
import {
  getVCSAccount,
  getVCSAccountByUsername,
} from "../db/repositories/vcs-accounts.js";
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
import { getProvider } from "../vcs/registry.js";

const POLL_INTERVAL = 60_000; // 60 seconds

let pollInterval: ReturnType<typeof setInterval> | null = null;

/** Map VCS PR state to our internal status. */
function mapPRStatus(state: "open" | "merged" | "closed"): PRStatusValue {
  if (state === "merged") return PRStatus.MERGED;
  if (state === "closed") return PRStatus.CLOSED;
  return PRStatus.OPEN;
}

/** Determine issue status based on PR state, mergeability, and CI status. */
function determineIssueStatus(
  mergeable: boolean | null,
  ciStatus: "pass" | "fail" | "pending",
): IssueStatusValue {
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

  // Get GitHub client (currently only provider, but ready for multi-provider)
  const vcsClient = getProvider("github");

  // Resolve OAuth token for each PR: project account first, then fallback to repo owner username
  const tokenCache = new Map<string, string | null>();

  function resolveToken(pr: (typeof openPRs)[number]): string | null {
    const key = pr.vcs_account_id ?? `owner:${pr.repo_owner}`;
    if (tokenCache.has(key)) return tokenCache.get(key)!;

    let token: string | null = null;
    if (pr.vcs_account_id) {
      token = getVCSAccount(pr.vcs_account_id)?.token ?? null;
    }
    if (!token) {
      token = getVCSAccountByUsername(pr.repo_owner)?.token ?? null;
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

    const prStatus = await vcsClient.fetchPRStatus({
      owner: pr.repo_owner,
      repo: pr.repo_name,
      prNumber: pr.pr_number,
      token,
    });

    if (!prStatus) continue;

    const newPRStatus = mapPRStatus(prStatus.state);

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
          actor_type: "system",
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

      // Fetch CI status
      const ciStatus = await vcsClient.fetchCIStatus({
        owner: pr.repo_owner,
        repo: pr.repo_name,
        ref: prStatus.head_sha,
        token,
      });

      const newIssueStatus = determineIssueStatus(
        prStatus.mergeable,
        ciStatus.result,
      );

      if (newIssueStatus !== issue.status) {
        updateIssue(pr.issue_id, { status: newIssueStatus });

        logger.info(
          {
            issue_id: pr.issue_id,
            pr_number: pr.pr_number,
            from: issue.status,
            to: newIssueStatus,
            mergeable: prStatus.mergeable,
            ciStatus: ciStatus.result,
          },
          "Issue status updated based on PR checks",
        );

        eventBus.emit("issue.status_changed", {
          issue_id: pr.issue_id,
          project_id: pr.project_id,
          from: issue.status,
          to: newIssueStatus,
          actor_type: "system",
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
