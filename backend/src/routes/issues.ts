import { Router, type Request } from "express";
import { listIssues, createIssue } from "../db/repositories/issues.js";
import { getProject } from "../db/repositories/projects.js";
import { validate } from "../middleware/validate.js";
import {
  verifyProject,
  verifyIssueOwnership,
  verifyIssueWithDetails,
} from "../middleware/ownership.js";
import { CreateIssueSchema, UpdateIssueSchema } from "../schemas/validation.js";
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
} from "../db/repositories/issue-dependencies.js";

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
  },
);

router.patch(
  "/:issueId",
  verifyIssueOwnership,
  validate(UpdateIssueSchema),
  (req, res) => {
    const excludeAgentId = req.headers["x-agent-id"] as string | undefined;
    const updated = updateIssue(req.issue!, req.body, excludeAgentId);
    res.json(updated);
  },
);

router.delete("/:issueId", verifyIssueOwnership, async (req, res) => {
  await deleteIssue(req.issue!);
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
