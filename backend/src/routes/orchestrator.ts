import { Router } from "express";
import { z } from "zod";
import { getProject, updateProject } from "../db/repositories/projects.js";
import { getSession, createSession, updateSession } from "../db/repositories/sessions.js";
import { NotFoundError } from "../middleware/errors.js";
import { validate } from "../middleware/validate.js";

const StartSchema = z.object({
  context: z.record(z.unknown()).optional(),
});

const router = Router({ mergeParams: true });

// GET /status — return current orchestrator state
router.get("/status", (req, res) => {
  const { projectId } = req.params;
  const project = getProject(projectId);
  if (!project) throw new NotFoundError("Project not found");

  const session = project.orchestrator_session_id
    ? getSession(project.orchestrator_session_id)
    : null;

  res.json({
    project_id: projectId,
    orchestrator_session_id: project.orchestrator_session_id,
    status: session?.status ?? "stopped",
    session,
  });
});

// POST /start — create or resume orchestrator session
router.post("/start", validate(StartSchema), (req, res) => {
  const { projectId } = req.params;
  const project = getProject(projectId);
  if (!project) throw new NotFoundError("Project not found");

  // Resume existing session if already running
  if (project.orchestrator_session_id) {
    const existing = getSession(project.orchestrator_session_id);
    if (existing && existing.status === "running") {
      res.json(existing);
      return;
    }
  }

  const session = createSession({
    project_id: projectId,
    session_type: "orchestrator",
    status: "running",
    context: req.body.context ?? {},
  });

  updateProject(projectId, { orchestrator_session_id: session.id });
  res.status(201).json(session);
});

// POST /stop — gracefully stop orchestrator
router.post("/stop", (req, res) => {
  const { projectId } = req.params;
  const project = getProject(projectId);
  if (!project) throw new NotFoundError("Project not found");

  if (!project.orchestrator_session_id) {
    res.json({ status: "stopped" });
    return;
  }

  const session = getSession(project.orchestrator_session_id);
  if (session) {
    updateSession(session.id, { status: "stopped" });
  }

  res.json({ status: "stopped" });
});

export default router;
