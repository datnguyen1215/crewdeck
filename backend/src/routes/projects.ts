import { Router } from "express";
import {
  listProjects,
  listProjectsWithStats,
  getProject,
  createProject,
  updateProject,
  deleteProject,
} from "../db/repositories/projects.js";
import { markSetupComplete } from "../db/repositories/auth.js";
import { getLatestLibrarianRun } from "../db/repositories/agent-runs.js";
import { resolveRepoMetadata } from "../vcs/resolve-repo-metadata.js";
import { validate } from "../middleware/validate.js";
import { requireScope } from "../middleware/scope.js";
import { NotFoundError } from "../middleware/errors.js";
import {
  CreateProjectSchema,
  UpdateProjectSchema,
} from "../schemas/validation.js";
import { eventBus } from "../events/bus.js";
import { startMonitorForProject } from "../orchestration/captain/monitor-service.js";
import { Scope } from "../constants/scopes.js";

const router = Router();

router.get("/", requireScope(Scope.PROJECTS_READ), (req, res) => {
  if (req.query.stats !== undefined) {
    res.json(listProjectsWithStats());
  } else {
    res.json(listProjects());
  }
});

router.get("/:id", requireScope(Scope.PROJECTS_READ), (req, res) => {
  const project = getProject(req.params.id);
  if (!project) throw new NotFoundError("Project not found");
  res.json(project);
});

router.post("/", requireScope(Scope.PROJECTS_WRITE), validate(CreateProjectSchema), async (req, res, next) => {
  try {
    const body = req.body;
    const metadata = await resolveRepoMetadata(
      body.repo_url,
      body.vcs_account_id,
    );

    const project = createProject({
      name: body.name || metadata.name,
      description: body.description || metadata.description || undefined,
      repo_url: body.repo_url,
      default_branch: metadata.default_branch,
      default_base_branch: body.default_base_branch ?? metadata.default_branch ?? "main",
      vcs_account_id: body.vcs_account_id,
    });

    if (!req.session!.setupCompleted) {
      markSetupComplete(req.session!.userId);
      req.session!.setupCompleted = 1;
    }

    startMonitorForProject(project.id);

    eventBus.emit("project.created", { project });
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", requireScope(Scope.PROJECTS_WRITE), validate(UpdateProjectSchema), (req, res) => {
  const existing = getProject(req.params.id);
  if (!existing) throw new NotFoundError("Project not found");
  const updated = updateProject(req.params.id, req.body);
  if (Object.keys(req.body).length > 0) {
    eventBus.emit("project.settings_changed", {
      project_id: req.params.id,
      changes: req.body,
    });
  }
  res.json(updated);
});

router.delete("/:id", requireScope(Scope.PROJECTS_DELETE), (req, res) => {
  const existing = getProject(req.params.id);
  if (!existing) throw new NotFoundError("Project not found");
  deleteProject(req.params.id);
  eventBus.emit("project.deleted", { project_id: req.params.id });
  res.status(204).send();
});

router.get("/:id/librarian-status", requireScope(Scope.PROJECTS_READ), (req, res) => {
  const existing = getProject(req.params.id);
  if (!existing) throw new NotFoundError("Project not found");
  const run = getLatestLibrarianRun(req.params.id);
  if (!run) {
    res.json({ status: null, started_at: null, completed_at: null });
    return;
  }
  res.json({
    status: run.status,
    started_at: run.started_at,
    completed_at: run.completed_at,
  });
});

router.get("/:id/captain/status", requireScope(Scope.PROJECTS_READ), (req, res) => {
  const project = getProject(req.params.id);
  if (!project) throw new NotFoundError("Project not found");

  const processingDurationMs = project.captain_processing_since
    ? Date.now() - new Date(project.captain_processing_since + "Z").getTime()
    : null;

  res.json({
    status: project.captain_status ?? "idle",
    detail: project.captain_status_detail ?? null,
    pending_count: project.captain_pending_count ?? 0,
    processing_since: project.captain_processing_since ?? null,
    processing_duration_ms: processingDurationMs,
  });
});

export default router;
