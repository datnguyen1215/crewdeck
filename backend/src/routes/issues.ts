import { Router, type Request } from "express";
import { existsSync } from "node:fs";
import {
  listIssues,
  createIssue,
  updateIssue,
  deleteIssue,
  getIssue,
  pausedIssues,
  pauseIssue as pauseIssueRepo,
  resumeIssue as resumeIssueRepo,
} from "../db/repositories/issues.js";
import { getRepo } from "../db/repositories/repos.js";
import { validate } from "../middleware/validate.js";
import { InvalidTransitionError, ConflictError, NotFoundError, ValidationError } from "../middleware/errors.js";
import {
  verifyProject,
  verifyIssueOwnership,
  verifyIssueWithDetails,
} from "../middleware/ownership.js";
import { CreateIssueSchema, UpdateIssueSchema } from "../schemas/validation.js";
import { eventBus } from "../events/bus.js";
import { cleanupWorktree } from "../orchestration/worktree.js";
import { logger } from "../logger.js";
import { hasActiveProcesses, activeProcesses } from "../orchestration/processes.js";
import { TRANSITIONS, IssueStatus } from "../constants/statuses.js";
import type { IssueFilters } from "../types/entities.js";
import * as agentRunRepo from "../db/repositories/agent-runs.js";
import * as batch from "../orchestration/batch.js";
import { spawnAgent } from "../orchestration/spawner.js";
import { getCrewMember } from "../orchestration/crew.js";

function assertTransition(from: string, to: string): void {
  const allowed = TRANSITIONS[from as keyof typeof TRANSITIONS] ?? [];
  if (to !== IssueStatus.DONE && !(allowed as string[]).includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

const router = Router({ mergeParams: true });

router.get("/", verifyProject, (req: Request<{ projectId: string }>, res) => {
  const { projectId } = req.params;
  const { status, created_by, sort, order } = req.query as Record<
    string,
    string
  >;

  const filters: IssueFilters = {};
  if (status) filters.status = status.split(",");
  if (created_by) filters.created_by = created_by;
  if (sort === "created_at" || sort === "updated_at") filters.sort = sort;
  if (order === "asc" || order === "desc") filters.order = order;

  res.json(listIssues(projectId, filters));
});

router.get("/:issueId", verifyIssueWithDetails, (req, res) => {
  res.json(req.issueWithDetails);
});

router.post(
  "/",
  verifyProject,
  validate(CreateIssueSchema),
  (req: Request<{ projectId: string }>, res) => {
    const { projectId } = req.params;
    const issue = createIssue(projectId, { ...req.body, created_by: "user" });
    eventBus.emit("issue.created", { issue });
    res.status(201).json(issue);
  },
);

router.patch(
  "/:issueId",
  verifyIssueOwnership,
  validate(UpdateIssueSchema),
  (req, res) => {
    const existing = req.issue!;
    const excludeAgentId = req.headers["x-agent-id"] as string | undefined;

    if (req.body.status && req.body.status !== existing.status) {
      assertTransition(existing.status, req.body.status);
      if (req.body.status === IssueStatus.DONE) {
        if (hasActiveProcesses(existing.id, excludeAgentId)) {
          throw new ConflictError(
            "Cannot mark as done — agents are still running on this issue",
          );
        }
      }
    }

    // Idempotent: no-op if only setting the same status
    const keys = Object.keys(req.body);
    if (
      keys.length === 1 &&
      req.body.status &&
      req.body.status === existing.status
    ) {
      res.json(existing);
      return;
    }

    const updated = updateIssue(existing.id, req.body);

    if (req.body.status && req.body.status !== existing.status) {
      eventBus.emit("issue.status_changed", {
        issue_id: updated.id,
        project_id: updated.project_id,
        from: existing.status,
        to: updated.status,
        actor_type: "user",
      });
    }

    res.json(updated);
  },
);

router.delete("/:issueId", verifyIssueOwnership, async (req, res) => {
  const issue = req.issue!;

  // Clean up worktree before deleting the issue
  const { worktree_path, branch_name, repo_id } = issue;
  if (worktree_path && branch_name && repo_id) {
    const repo = getRepo(repo_id);
    if (repo && existsSync(worktree_path)) {
      try {
        await cleanupWorktree(repo, worktree_path, branch_name, true);
        logger.info({ issue_id: issue.id, worktree_path }, "Worktree cleaned up during issue deletion");
      } catch (err) {
        logger.warn({ err, issue_id: issue.id, worktree_path }, "Failed to cleanup worktree during deletion, continuing");
      }
    }
  }

  deleteIssue(issue.id);
  res.status(204).send();
});

router.post("/:issueId/pause", verifyIssueOwnership, (req, res) => {
  const issue = req.issue!;

  // Validate issue is not already paused
  if (pausedIssues.has(issue.id)) {
    throw new ValidationError("Issue is already paused");
  }

  // Validate issue is not done
  if (issue.status === IssueStatus.DONE) {
    throw new ValidationError("Cannot pause a completed issue");
  }

  // Step 1: Set in-memory paused flag FIRST (prevents race conditions)
  pausedIssues.add(issue.id);

  // Step 2: Kill all active agent processes for this issue
  for (const [pid, proc] of activeProcesses.entries()) {
    if (proc.issueId === issue.id) {
      logger.info(
        { pid, issueId: issue.id, agentId: proc.agentId },
        "Killing agent process for paused issue"
      );
      proc.process.kill("SIGTERM");
      clearTimeout(proc.timer);
      activeProcesses.delete(pid);
    }
  }

  // Step 3: Purge all queued dispatches for this issue
  const queuedRuns = agentRunRepo.listQueuedRuns(issue.project_id);
  for (const run of queuedRuns) {
    if (run.issue_id === issue.id) {
      logger.info(
        { runId: run.id, issueId: issue.id, agentId: run.agent_id },
        "Cancelling queued run for paused issue"
      );
      agentRunRepo.updateAgentRun(run.id, { status: "failed" });
    }
  }

  // Step 4: Clear batch tracking for this issue
  const batchId = batch.issueBatches.get(issue.id);
  if (batchId) {
    const batchData = batch.batches.get(batchId);
    if (batchData) {
      logger.info({ batchId, issueId: issue.id }, "Clearing batch for paused issue");
      batch.handleBatchComplete(batchData);
    }
  }

  // Step 5: Persist paused = true to DB
  pauseIssueRepo(issue.id);

  // Step 6: Emit issue.paused event
  eventBus.emit("issue.paused", {
    issue_id: issue.id,
    project_id: issue.project_id,
  });

  logger.info({ issueId: issue.id }, "Issue paused");

  res.json({
    success: true,
    issue_id: issue.id,
    paused: true,
  });
});

router.post("/:issueId/resume", verifyIssueOwnership, async (req, res) => {
  const issue = req.issue!;

  // Validate issue is currently paused
  if (!pausedIssues.has(issue.id)) {
    throw new ValidationError("Issue is not paused");
  }

  // Validate issue is not done
  if (issue.status === IssueStatus.DONE) {
    throw new ValidationError("Cannot resume a completed issue");
  }

  // Step 1: Unset in-memory paused flag
  pausedIssues.delete(issue.id);

  // Step 2: Persist paused = false to DB
  resumeIssueRepo(issue.id);

  // Step 3: Emit issue.resumed event
  eventBus.emit("issue.resumed", {
    issue_id: issue.id,
    project_id: issue.project_id,
  });

  // Step 4: Auto-dispatch captain to pick up where it left off
  const captain = getCrewMember("captain");
  if (captain) {
    logger.info({ issueId: issue.id }, "Auto-dispatching captain after resume");
    spawnAgent(captain, issue.id, issue.project_id).catch((err) => {
      logger.error(
        { err, issueId: issue.id },
        "Failed to auto-dispatch captain after resume"
      );
    });
  } else {
    logger.warn({ issueId: issue.id }, "Captain agent not found for auto-dispatch");
  }

  logger.info({ issueId: issue.id }, "Issue resumed");

  res.json({
    success: true,
    issue_id: issue.id,
    paused: false,
  });
});

export default router;
