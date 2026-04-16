import { existsSync } from "node:fs";
import {
  pauseIssue as pauseIssueRepo,
  resumeIssue as resumeIssueRepo,
  listPausedIssueIds,
  updateIssue as updateIssueRepo,
  deleteIssue as deleteIssueRepo,
} from "../db/repositories/issues.js";
import { getRepo } from "../db/repositories/repos.js";
import { eventBus } from "../events/bus.js";
import { logger } from "../logger.js";
import {
  activeProcesses,
  hasActiveProcesses,
} from "../orchestration/processes.js";
import * as agentRunRepo from "../db/repositories/agent-runs.js";
import * as agentSessionRepo from "../db/repositories/agent-sessions.js";
import * as batch from "../orchestration/batch.js";
import { approveStart, approveMerge } from "../orchestration/approval-store.js";
import { stopSupervisorForIssue } from "../orchestration/supervisor/supervisor-service.js";
import { IssueStatus, TRANSITIONS } from "../constants/statuses.js";
import {
  InvalidTransitionError,
  ConflictError,
  ValidationError,
} from "../middleware/errors.js";
import { cleanupWorktree } from "../orchestration/worktree.js";
import type { Issue, UpdateIssueInput } from "../types/entities.js";

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

export function assertTransition(from: string, to: string): void {
  const allowed = TRANSITIONS[from as keyof typeof TRANSITIONS] ?? [];
  if (to !== IssueStatus.DONE && !(allowed as string[]).includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function updateIssue(
  issue: Issue,
  body: UpdateIssueInput,
  excludeAgentId?: string,
): Issue {
  if (body.status && body.status !== issue.status) {
    assertTransition(issue.status, body.status);
    if (body.status === IssueStatus.DONE) {
      if (hasActiveProcesses(issue.id, excludeAgentId)) {
        throw new ConflictError(
          "Cannot mark as done — agents are still running on this issue",
        );
      }
    }
  }

  // Idempotent: no-op if only setting the same status
  const keys = Object.keys(body);
  if (keys.length === 1 && body.status && body.status === issue.status) {
    return issue;
  }

  const updated = updateIssueRepo(issue.id, body);

  if (body.status && body.status !== issue.status) {
    eventBus.emit("issue.status_changed", {
      issue_id: updated.id,
      project_id: updated.project_id,
      from: issue.status,
      to: updated.status,
      actor_type: "user",
    });
  }

  return updated;
}

export async function deleteIssue(issue: Issue): Promise<void> {
  const { worktree_path, branch_name, repo_id } = issue;
  if (worktree_path && branch_name && repo_id) {
    const repo = getRepo(repo_id);
    if (repo && existsSync(worktree_path)) {
      try {
        await cleanupWorktree(repo, worktree_path, branch_name, true);
        logger.info(
          { issue_id: issue.id, worktree_path },
          "Worktree cleaned up during issue deletion",
        );
      } catch (err) {
        logger.warn(
          { err, issue_id: issue.id, worktree_path },
          "Failed to cleanup worktree during deletion, continuing",
        );
      }
    }
  }

  pausedIssues.delete(issue.id);
  deleteIssueRepo(issue.id);
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

  // Stop the Supervisor for this issue and cancel any pending batch timer
  stopSupervisorForIssue(issue.id);

  // Clear all agent sessions so a fresh start occurs on resume
  agentSessionRepo.deleteByIssue(issue.id);

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

  // Workaround: reuse issue.approved_to_start to trigger Captain to spawn a fresh
  // Supervisor on resume. issue.resumed is not in Captain's HANDLER_CONFIGS, so it
  // would be silently ignored. We call approveStart() first so Captain's state
  // snapshot correctly shows the issue as (approved-to-start). Remove this once
  // issue.resumed is wired into Captain's event subscriptions.
  approveStart(issue.id);
  eventBus.emit("issue.approved_to_start", {
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
