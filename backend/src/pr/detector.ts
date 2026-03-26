/**
 * PR URL detector: Subscribes to comment.added events and auto-links VCS PRs.
 *
 * When a comment is posted containing a PR URL (e.g. https://github.com/owner/repo/pull/123),
 * this module creates an IssuePR record linking the PR to the issue.
 */
import { eventBus } from "../events/bus.js";
import { listRepos } from "../db/repositories/repos.js";
import { getIssue } from "../db/repositories/issues.js";
import { PRStatus } from "../constants/statuses.js";
import {
  createIssuePR,
  getIssuePRByRepoAndNumber,
} from "../db/repositories/issue-prs.js";
import { logger } from "../logger.js";
import { getAllProviders } from "../vcs/registry.js";
import type { ParsedPRUrl } from "../vcs/types.js";

export type ParsedPR = ParsedPRUrl;

/** Extract all PR URLs from text content using registered VCS providers. */
export function parsePRUrls(content: string): ParsedPR[] {
  const results: ParsedPR[] = [];

  // Try all registered VCS providers
  for (const client of getAllProviders()) {
    results.push(...client.parsePRUrls(content));
  }

  return results;
}

export function initPRDetector(): void {
  eventBus.on("comment.added", ({ comment, project_id }) => {
    try {
      const parsedPRs = parsePRUrls(comment.content);
      if (parsedPRs.length === 0) return;

      const issue = getIssue(comment.issue_id);
      if (!issue) {
        logger.warn(
          { issue_id: comment.issue_id },
          "Issue not found for PR detection",
        );
        return;
      }

      // Get all repos for the project to match against PR URLs
      const repos = listRepos(project_id);
      if (repos.length === 0) return;

      for (const pr of parsedPRs) {
        // Find matching repo by owner/name
        const repo = repos.find(
          (r) =>
            r.owner.toLowerCase() === pr.owner.toLowerCase() &&
            r.name.toLowerCase() === pr.name.toLowerCase(),
        );

        if (!repo) {
          logger.debug(
            { owner: pr.owner, name: pr.name },
            "PR URL does not match any project repo",
          );
          continue;
        }

        // Skip if already linked (dedup by pr_number + repo_id)
        const existing = getIssuePRByRepoAndNumber(repo.id, pr.prNumber);
        if (existing) {
          logger.debug(
            { pr_number: pr.prNumber, repo_id: repo.id },
            "PR already linked to an issue",
          );
          continue;
        }

        // Create IssuePR record
        const issuePR = createIssuePR({
          issue_id: issue.id,
          repo_id: repo.id,
          pr_number: pr.prNumber,
          pr_url: pr.url,
          status: PRStatus.OPEN,
        });

        logger.info(
          {
            pr_number: pr.prNumber,
            issue_id: issue.id,
            repo: `${pr.owner}/${pr.name}`,
          },
          "Auto-linked PR from comment",
        );

        // Emit event for frontend updates
        eventBus.emit("pr.created", { issue_pr: issuePR, project_id });
      }
    } catch (err) {
      logger.error(
        { err, comment_id: comment.id },
        "Failed to detect PR URLs in comment",
      );
    }
  });

  logger.info("PR detector initialized");
}
