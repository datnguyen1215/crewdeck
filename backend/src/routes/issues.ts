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
  ValidationError,
} from "../middleware/errors.js";
import {
  verifyProject,
  verifyIssueOwnership,
  verifyIssueWithDetails,
} from "../middleware/ownership.js";
import { CreateIssueSchema, UpdateIssueSchema } from "../schemas/validation.js";
import { eventBus } from "../events/bus.js";
import type { IssueFilters } from "../types/entities.js";

// Valid status transitions
const TRANSITIONS: Record<string, string[]> = {
  draft: ["open"],
  open: ["in_progress", "done"],
  in_progress: ["in_review", "done"],
  in_review: ["feedback", "ready", "done"],
  feedback: ["in_progress", "done"],
  ready: ["pr_created", "done"],
  pr_created: ["done"],
};

function assertTransition(from: string, to: string): void {
  const allowed = TRANSITIONS[from] ?? [];
  // Intentional: any status can transition to "done" (manual close) as an escape hatch.
  if (to !== "done" && !allowed.includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

const router = Router({ mergeParams: true });

router.get("/", verifyProject, (req: Request<{ projectId: string }>, res) => {
  const { projectId } = req.params;
  const { status, agent, created_by, sort, order } = req.query as Record<
    string,
    string
  >;

  const filters: IssueFilters = {};
  if (status) filters.status = status.split(",");
  if (agent) filters.assigned_agent_id = agent;
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

// Intentional: dedicated action routes for clarity, even though PATCH could handle these transitions.
// POST /approve — draft → open
router.post("/:issueId/approve", verifyIssueOwnership, (req, res) => {
  const issue = req.issue!;
  if (issue.status !== "draft") {
    throw new InvalidTransitionError(issue.status, "open");
  }
  const updated = updateIssue(issue.id, { status: "open" });
  eventBus.emit("issue.approved", { issue: updated });
  res.json(updated);
});

// POST /discard — delete draft
router.post("/:issueId/discard", verifyIssueOwnership, (req, res) => {
  const issue = req.issue!;
  if (issue.status !== "draft") {
    throw new ValidationError("Only draft issues can be discarded");
  }
  deleteIssue(issue.id);
  res.status(204).send();
});

// POST /create-pr — push branch and create GitHub PR for a ready issue
router.post("/:issueId/create-pr", verifyIssueOwnership, (req, res) => {
  const issue = req.issue!;
  if (issue.status !== "ready") {
    throw new InvalidTransitionError(issue.status, "pr_created");
  }
  eventBus.emit("captain.create_pr", {
    project_id: issue.project_id,
    issue_id: issue.id,
  });
  res.json({ ok: true });
});

export default router;
