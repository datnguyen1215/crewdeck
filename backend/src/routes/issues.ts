import { Router, type Request } from "express";
import { existsSync } from "node:fs";
import {
  listIssues,
  createIssue,
  updateIssue,
  deleteIssue,
  getIssue,
} from "../db/repositories/issues.js";
import { getRepo } from "../db/repositories/repos.js";
import { validate } from "../middleware/validate.js";
import {
  InvalidTransitionError,
  ConflictError,
  NotFoundError,
} from "../middleware/errors.js";
import {
  verifyProject,
  verifyIssueOwnership,
  verifyIssueWithDetails,
} from "../middleware/ownership.js";
import { CreateIssueSchema, UpdateIssueSchema } from "../schemas/validation.js";
import { eventBus } from "../events/bus.js";
import { cleanupWorktree } from "../orchestration/worktree.js";
import { logger } from "../logger.js";
import { hasActiveProcesses } from "../orchestration/processes.js";
import { TRANSITIONS, IssueStatus } from "../constants/statuses.js";
import type { IssueFilters } from "../types/entities.js";
import {
  pauseIssue,
  resumeIssue,
  approveIssueForStart,
  approveIssueForMerge,
  clearPausedState,
} from "../services/issue-service.js";
import {
  listDependenciesBatchWithDetails,
  listDependentsBatchWithDetails,
} from "../db/repositories/issue-dependencies.js";

function assertTransition(from: string, to: string): void {
  const allowed = TRANSITIONS[from as keyof typeof TRANSITIONS] ?? [];
  if (to !== IssueStatus.DONE && !(allowed as string[]).includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

const router = Router({ mergeParams: true });

router.get("/", verifyProject, (req: Request<{ projectId: string }>, res) => {
  const { projectId } = req.params;
  const { status, created_by, sort, order, compact } = req.query as Record<
    string,
    string
  >;

  const filters: IssueFilters = {};
  if (status) filters.status = status.split(",");
  if (created_by) filters.created_by = created_by;
  if (sort === "created_at" || sort === "updated_at") filters.sort = sort;
  if (order === "asc" || order === "desc") filters.order = order;

  const issues = listIssues(projectId, filters);

  const issueIds = issues.map((i) => i.id);
  const depsMap = listDependenciesBatchWithDetails(issueIds);
  const dependentsMap = listDependentsBatchWithDetails(issueIds);
  const enriched = issues.map((i) => ({
    ...i,
    dependencies: depsMap.get(i.id) ?? [],
    dependents: dependentsMap.get(i.id) ?? [],
  }));

  if (compact === "true") {
    res.json(enriched.map(({ description, ...rest }) => rest));
  } else {
    res.json(enriched);
  }
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

  deleteIssue(issue.id);
  clearPausedState(issue.id);
  res.status(204).send();
});

router.post("/:issueId/pause", verifyIssueOwnership, (req, res) => {
  pauseIssue(req.issue!);
  res.json({ success: true, issue_id: req.issue!.id, paused: true });
});

router.post("/:issueId/resume", verifyIssueOwnership, (req, res) => {
  resumeIssue(req.issue!);
  res.json({ success: true, issue_id: req.issue!.id, paused: false });
});

router.post("/:issueId/approve-start", verifyIssueOwnership, (req, res) => {
  approveIssueForStart(req.issue!);
  res.json({ success: true, issue_id: req.issue!.id, approved_to_start: true });
});

router.post("/:issueId/approve-merge", verifyIssueOwnership, (req, res) => {
  approveIssueForMerge(req.issue!);
  res.json({ success: true, issue_id: req.issue!.id, approved_to_merge: true });
});

export default router;
