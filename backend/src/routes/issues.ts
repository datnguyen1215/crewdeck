import { Router, type Request } from "express";
import { listIssues, createIssue, listIssuesPaginated, getIssue } from "../db/repositories/issues.js";
import { getProject } from "../db/repositories/projects.js";
import { validate } from "../middleware/validate.js";
import { requireScope } from "../middleware/scope.js";
import { ValidationError } from "../middleware/errors.js";
import { Scope } from "../constants/scopes.js";
import {
  verifyProject,
  verifyIssueOwnership,
  verifyIssueWithDetails,
} from "../middleware/ownership.js";
import { CreateIssueSchema, UpdateIssueSchema, SetDependenciesSchema } from "../schemas/validation.js";
import { eventBus } from "../events/bus.js";
import type { IssueFilters } from "../types/entities.js";
import {
  pauseIssue,
  resumeIssue,
  approveIssueForStart,
  approveIssueForMerge,
  updateIssue,
  deleteIssue,
} from "../services/issue-service.js";
import {
  listDependenciesBatchWithDetails,
  listDependentsBatchWithDetails,
  setDependencies,
  wouldCreateCycle,
} from "../db/repositories/issue-dependencies.js";
import { summarizeIssueAsync } from "../orchestration/summarizer.js";

const router = Router({ mergeParams: true });

router.get("/", requireScope(Scope.ISSUES_READ), verifyProject, (req: Request<{ projectId: string }>, res) => {
  const { projectId } = req.params;
  const { status, created_by, sort, order, compact, limit, offset } = req.query as Record<
    string,
    string
  >;

  const filters: IssueFilters = {};
  if (status) filters.status = status.split(",");
  if (created_by) filters.created_by = created_by;
  if (sort === "created_at" || sort === "updated_at") filters.sort = sort;
  if (order === "asc" || order === "desc") filters.order = order;

  if (limit) {
    const parsed = parseInt(limit, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new ValidationError("limit must be a non-negative integer");
    }
    filters.limit = parsed;
  }
  if (offset) {
    const parsed = parseInt(offset, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new ValidationError("offset must be a non-negative integer");
    }
    filters.offset = parsed;
  }

  // Default: exclude done status unless explicitly requested
  if (!filters.status) {
    filters.status = [
      "open",
      "in_progress",
      "pr_created",
      "pr_conflict",
      "pr_failed_actions",
      "pr_ready_to_merge",
    ];
  }

  const result = listIssuesPaginated(projectId, filters);

  const issueIds = result.issues.map((i) => i.id);
  const depsMap = listDependenciesBatchWithDetails(issueIds);
  const dependentsMap = listDependentsBatchWithDetails(issueIds);
  const enriched = result.issues.map((i) => ({
    ...i,
    dependencies: depsMap.get(i.id) ?? [],
    dependents: dependentsMap.get(i.id) ?? [],
  }));

  if (compact === "true") {
    res.json({
      issues: enriched.map(({ description, ...rest }) => rest),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  } else {
    res.json({
      issues: enriched,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  }
});

router.get("/:issueId", requireScope(Scope.ISSUES_READ), verifyIssueWithDetails, (req, res) => {
  res.json(req.issueWithDetails);
});

router.post(
  "/",
  requireScope(Scope.ISSUES_CREATE),
  verifyProject,
  validate(CreateIssueSchema),
  (req: Request<{ projectId: string }>, res) => {
    const { projectId } = req.params;
    const project = getProject(projectId)!;
    const baseBranch =
      req.body.base_branch || project.default_base_branch || "main";
    const issue = createIssue(projectId, {
      ...req.body,
      created_by: "user",
      base_branch: baseBranch,
    });
    eventBus.emit("issue.created", { issue });
    res.status(201).json(issue);

    // Fire-and-forget: generate summary asynchronously (errors handled internally)
    summarizeIssueAsync(issue.id, issue.title, issue.description);
  },
);

router.patch(
  "/:issueId",
  requireScope(Scope.ISSUES_UPDATE),
  verifyIssueOwnership,
  validate(UpdateIssueSchema),
  (req, res) => {
    const excludeAgentId = req.headers["x-agent-id"] as string | undefined;
    const updated = updateIssue(req.issue!, req.body, excludeAgentId);
    res.json(updated);
  },
);

router.delete("/:issueId", requireScope(Scope.ISSUES_DELETE), verifyIssueOwnership, async (req, res) => {
  await deleteIssue(req.issue!);
  res.status(204).send();
});

router.post("/:issueId/pause", requireScope(Scope.ISSUES_PAUSE), verifyIssueOwnership, (req, res) => {
  pauseIssue(req.issue!);
  res.json({ success: true, issue_id: req.issue!.id, paused: true });
});

router.post("/:issueId/resume", requireScope(Scope.ISSUES_RESUME), verifyIssueOwnership, (req, res) => {
  resumeIssue(req.issue!);
  res.json({ success: true, issue_id: req.issue!.id, paused: false });
});

router.post("/:issueId/approve-start", requireScope(Scope.ISSUES_APPROVE), verifyIssueOwnership, (req, res) => {
  approveIssueForStart(req.issue!);
  res.json({ success: true, issue_id: req.issue!.id, approved_to_start: true });
});

router.post("/:issueId/approve-merge", requireScope(Scope.ISSUES_APPROVE), verifyIssueOwnership, (req, res) => {
  approveIssueForMerge(req.issue!);
  res.json({ success: true, issue_id: req.issue!.id, approved_to_merge: true });
});

router.put(
  "/:issueId/dependencies",
  requireScope(Scope.ISSUES_UPDATE),
  verifyIssueOwnership,
  validate(SetDependenciesSchema),
  (req, res) => {
    const { depends_on } = req.body;
    const issueId = req.issue!.id;

    // Validate all dependency IDs exist and belong to the same project
    for (const depId of depends_on) {
      if (depId === issueId) {
        throw new ValidationError("Issue cannot depend on itself");
      }
      const dep = getIssue(depId);
      if (!dep) {
        throw new ValidationError(`Issue not found: ${depId}`);
      }
      if (dep.project_id !== req.issue!.project_id) {
        throw new ValidationError(`Issue ${depId} is not in this project`);
      }
      if (wouldCreateCycle(issueId, depId)) {
        throw new ValidationError(
          `Circular dependency detected: adding dependency on ${depId} would create a cycle`,
        );
      }
    }

    const added = setDependencies(issueId, depends_on);

    // Detect any dependencies silently dropped (e.g. cycle created by earlier inserts in batch)
    const dropped = depends_on.filter((id: string) => !added.includes(id));
    if (dropped.length > 0) {
      throw new ValidationError(
        `Circular dependency detected: could not set dependencies on ${dropped.join(", ")}`,
      );
    }

    const depsMap = listDependenciesBatchWithDetails([issueId]);
    res.json({
      success: true,
      issue_id: issueId,
      dependencies: depsMap.get(issueId) ?? [],
    });
  },
);

export default router;
