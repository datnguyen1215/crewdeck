/**
 * Deterministic event-to-comment bridge.
 * Posts system comments when system events occur, making event data visible
 * to all agents without requiring LLM calls to external APIs.
 */
import { eventBus } from "./bus.js";
import { createComment } from "../db/repositories/comments.js";
import { getIssuePR } from "../db/repositories/issue-prs.js";
import { getProject } from "../db/repositories/projects.js";
import { enqueueRun, isAgentActive } from "../orchestration/dispatch-queue.js";
import { logger } from "../logger.js";

/**
 * Format duration in milliseconds to human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Format cost in USD to human-readable string.
 */
function formatCost(usd: number | null): string {
  if (usd === null || usd === undefined) return "N/A";
  return `$${usd.toFixed(4)}`;
}

/**
 * Post a system comment to an issue.
 */
function postComment(issueId: string, content: string): void {
  createComment(issueId, {
    content,
    author_type: "system",
  });
}

/**
 * Auto-start captain if project has auto_start enabled and captain not already active.
 */
function autoStartCaptain(projectId: string, issueId: string): void {
  const project = getProject(projectId);
  if (!project?.auto_start) return;

  const captainId = "captain";
  if (isAgentActive(projectId, issueId, captainId)) {
    logger.debug(
      { projectId, issueId },
      "Captain already active, skipping auto-start",
    );
    return;
  }

  enqueueRun(projectId, issueId, captainId);
  logger.info({ projectId, issueId }, "Auto-started captain");
}

/**
 * Initialize event commenter by subscribing to relevant events.
 */
export function initEventCommenter(): void {
  // Agent run completed
  eventBus.on("run.completed", (data) => {
    if (!data.issue_id) return;

    const statusEmoji =
      data.status === "completed" ? "✅" : data.status === "timeout" ? "⏱️" : "❌";
    const statusText =
      data.status === "completed"
        ? "completed"
        : data.status === "timeout"
          ? "timed out"
          : "failed";

    const parts = [
      `${statusEmoji} **${data.agent_id}** ${statusText}`,
      data.exit_code !== null ? `(exit code ${data.exit_code})` : null,
      data.cost_usd !== null ? `Cost: ${formatCost(data.cost_usd)}` : null,
      data.duration_ms !== null
        ? `Duration: ${formatDuration(data.duration_ms)}`
        : null,
    ].filter(Boolean);

    postComment(data.issue_id, parts.join(". ") + ".");

    // Auto-start captain if configured
    autoStartCaptain(data.project_id, data.issue_id);
  });

  // PR status changed
  eventBus.on("pr.status_changed", (data) => {
    // Find the issue_id from the pr_id
    const issuePR = getIssuePR(data.pr_id);
    if (!issuePR) {
      logger.warn({ pr_id: data.pr_id }, "IssuePR not found for status change");
      return;
    }

    let message: string;
    if (data.to === "merged") {
      message = `🎉 **PR #${issuePR.pr_number} merged**.`;
    } else if (data.to === "closed") {
      message = `🚫 **PR #${issuePR.pr_number} closed** (not merged).`;
    } else {
      message = `🔄 **PR #${issuePR.pr_number}** status changed: ${data.from} → ${data.to}.`;
    }

    postComment(issuePR.issue_id, message);

    // Auto-start captain if configured
    autoStartCaptain(data.project_id, issuePR.issue_id);
  });

  // Issue status changed
  eventBus.on("issue.status_changed", (data) => {
    // Map status values to human-readable messages
    const statusMessages: Record<string, string> = {
      open: "📋 Open",
      in_progress: "🔨 In Progress",
      pr_created: "🔀 PR Created",
      pr_conflict: "⚠️ PR has merge conflicts",
      pr_failed_actions: "❌ PR checks failed",
      pr_ready_to_merge: "✅ PR ready to merge",
      done: "✅ Done",
    };

    const fromText = statusMessages[data.from] ?? data.from;
    const toText = statusMessages[data.to] ?? data.to;

    const message = `📊 Issue status: ${fromText} → ${toText}`;
    postComment(data.issue_id, message);

    // Auto-start captain if configured
    autoStartCaptain(data.project_id, data.issue_id);
  });

  logger.info("Event commenter initialized");
}
