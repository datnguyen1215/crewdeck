import {
  pauseIssue as pauseIssueRepo,
  resumeIssue as resumeIssueRepo,
  listPausedIssueIds,
} from "../db/repositories/issues.js";
import { eventBus } from "../events/bus.js";
import { logger } from "../logger.js";
import { activeProcesses } from "../orchestration/processes.js";
import * as agentRunRepo from "../db/repositories/agent-runs.js";
import * as batch from "../orchestration/batch.js";
import { approveStart, approveMerge } from "../orchestration/approval-store.js";
import { IssueStatus } from "../constants/statuses.js";
import { ValidationError } from "../middleware/errors.js";
import type { Issue } from "../types/entities.js";

/**
 * In-memory set of paused issue IDs for fast checks without DB reads.
 * Initialized on server startup via initializePausedState().
 */
const pausedIssues = new Set<string>();

export function initializePausedState(): void {
  pausedIssues.clear();
  for (const id of listPausedIssueIds()) {
    pausedIssues.add(id);
  }
}

export function isIssuePaused(issueId: string): boolean {
  return pausedIssues.has(issueId);
}

export function pauseIssue(issue: Issue): void {
  if (pausedIssues.has(issue.id)) {
    throw new ValidationError("Issue is already paused");
  }
  if (issue.status === IssueStatus.DONE) {
    throw new ValidationError("Cannot pause a completed issue");
  }

  // Set in-memory flag first to prevent race conditions
  pausedIssues.add(issue.id);

  // Kill all active agent processes for this issue
  for (const [pid, proc] of activeProcesses.entries()) {
    if (proc.issueId === issue.id) {
      logger.info(
        { pid, issueId: issue.id, agentId: proc.agentId },
        "Killing agent process for paused issue",
      );
      proc.process.kill("SIGTERM");
      clearTimeout(proc.timer);
      activeProcesses.delete(pid);
    }
  }

  // Purge all queued dispatches for this issue
  const queuedRuns = agentRunRepo.listQueuedRuns(issue.project_id);
  for (const run of queuedRuns) {
    if (run.issue_id === issue.id) {
      logger.info(
        { runId: run.id, issueId: issue.id, agentId: run.agent_id },
        "Cancelling queued run for paused issue",
      );
      agentRunRepo.updateAgentRun(run.id, { status: "failed" });
    }
  }

  // Clear batch tracking for this issue
  const batchId = batch.issueBatches.get(issue.id);
  if (batchId) {
    logger.info(
      { batchId, issueId: issue.id },
      "Clearing batch for paused issue",
    );
    batch.batches.delete(batchId);
    batch.issueBatches.delete(issue.id);
  }

  // Persist to DB
  pauseIssueRepo(issue.id);

  eventBus.emit("issue.paused", {
    issue_id: issue.id,
    project_id: issue.project_id,
  });

  logger.info({ issueId: issue.id }, "Issue paused");
}

export function resumeIssue(issue: Issue): void {
  if (!pausedIssues.has(issue.id)) {
    throw new ValidationError("Issue is not paused");
  }
  if (issue.status === IssueStatus.DONE) {
    throw new ValidationError("Cannot resume a completed issue");
  }

  pausedIssues.delete(issue.id);

  resumeIssueRepo(issue.id);

  eventBus.emit("issue.resumed", {
    issue_id: issue.id,
    project_id: issue.project_id,
  });

  logger.info({ issueId: issue.id }, "Issue resumed");
}

export function approveIssueForStart(issue: Issue): void {
  if (pausedIssues.has(issue.id)) {
    throw new ValidationError("Cannot approve a paused issue for work");
  }
  if (issue.status === IssueStatus.DONE) {
    throw new ValidationError("Cannot approve a completed issue for work");
  }

  approveStart(issue.id);

  eventBus.emit("issue.approved_to_start", {
    issue_id: issue.id,
    project_id: issue.project_id,
  });

  logger.info({ issueId: issue.id }, "Issue approved to start");
}

export function approveIssueForMerge(issue: Issue): void {
  if (!issue.status.startsWith("pr_")) {
    throw new ValidationError("Cannot approve merge — issue has no PR");
  }

  approveMerge(issue.id);

  eventBus.emit("issue.approved_to_merge", {
    issue_id: issue.id,
    project_id: issue.project_id,
  });

  logger.info({ issueId: issue.id }, "Issue approved to merge");
}

/**
 * Clears the paused flag for a deleted issue.
 * Called before deleteIssue in the delete route handler.
 */
export function clearPausedState(issueId: string): void {
  pausedIssues.delete(issueId);
}
