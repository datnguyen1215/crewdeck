import { Router, type Request } from "express";
import {
  listIssues,
  createIssue,
  updateIssue,
  deleteIssue,
} from "../db/repositories/issues.js";
import { validate } from "../middleware/validate.js";
import {
  InvalidTransitionError,
  ConflictError,
} from "../middleware/errors.js";
import {
  verifyProject,
  verifyIssueOwnership,
  verifyIssueWithDetails,
} from "../middleware/ownership.js";
import { CreateIssueSchema, UpdateIssueSchema } from "../schemas/validation.js";
import { eventBus } from "../events/bus.js";
import { hasActiveProcesses } from "../mention/handler.js";
import type { IssueFilters } from "../types/entities.js";

const TRANSITIONS: Record<string, string[]> = {
  open: ["in_progress", "done"],
  in_progress: ["pr_created", "done"],
  pr_created: ["in_progress", "done"],
};

function assertTransition(from: string, to: string): void {
  const allowed = TRANSITIONS[from] ?? [];
  if (to !== "done" && !allowed.includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

const router = Router({ mergeParams: true });

router.get("/", verifyProject, (req: Request<{ projectId: string }>, res) => {
  const { projectId } = req.params;
  const { status, created_by, sort, order } = req.query as Record<string, string>;

  const filters: IssueFilters = {};
  if (status) filters.status = status.split(",");
  if (created_by) filters.created_by = created_by;
  if (sort === "priority" || sort === "created_at" || sort === "updated_at")
    filters.sort = sort;
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

    if (req.body.status && req.body.status !== existing.status) {
      assertTransition(existing.status, req.body.status);
    }

    const updated = updateIssue(existing.id, req.body);

    if (req.body.status && req.body.status !== existing.status) {
      eventBus.emit("issue.status_changed", {
        issue_id: updated.id,
        project_id: updated.project_id,
        from: existing.status,
        to: updated.status,
      });
    }

    res.json(updated);
  },
);

router.delete("/:issueId", verifyIssueOwnership, (req, res) => {
  deleteIssue(req.issue!.id);
  res.status(204).send();
});

// POST /mark-pr-created — transition to pr_created
router.post("/:issueId/mark-pr-created", verifyIssueOwnership, (req, res) => {
  const issue = req.issue!;
  assertTransition(issue.status, "pr_created");
  const updated = updateIssue(issue.id, { status: "pr_created" });
  eventBus.emit("issue.status_changed", {
    issue_id: updated.id,
    project_id: updated.project_id,
    from: issue.status,
    to: "pr_created",
  });
  res.json(updated);
});

// POST /mark-done — transition to done (rejected if active processes)
router.post("/:issueId/mark-done", verifyIssueOwnership, (req, res) => {
  const issue = req.issue!;
  if (hasActiveProcesses(issue.id)) {
    throw new ConflictError("Cannot mark as done — agents are still running on this issue");
  }
  const from = issue.status;
  if (from === "done") { res.json(issue); return; }
  const updated = updateIssue(issue.id, { status: "done" });
  eventBus.emit("issue.status_changed", {
    issue_id: updated.id,
    project_id: updated.project_id,
    from,
    to: "done",
  });
  res.json(updated);
});

// POST /reset-chain-depth — reset chain depth counter
router.post("/:issueId/reset-chain-depth", verifyIssueOwnership, (req, res) => {
  const issue = req.issue!;
  const updated = updateIssue(issue.id, { chain_depth: 0 });
  res.json(updated);
});

export default router;
