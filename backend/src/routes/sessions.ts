import { Router } from "express";
import { listSessions, getSession } from "../db/repositories/sessions.js";
import { getProject } from "../db/repositories/projects.js";
import { NotFoundError } from "../middleware/errors.js";
import type { SessionFilters } from "../types/entities.js";

const router = Router({ mergeParams: true });

router.get("/", (req, res) => {
  const { projectId } = req.params;
  if (!getProject(projectId)) throw new NotFoundError("Project not found");

  const { status, type, issue_id } = req.query as Record<string, string>;
  const filters: SessionFilters = {};
  if (status) filters.status = status;
  if (type) filters.session_type = type;
  if (issue_id) filters.issue_id = issue_id;

  res.json(listSessions(projectId, filters));
});

router.get("/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session || session.project_id !== req.params.projectId) {
    throw new NotFoundError("Session not found");
  }
  res.json(session);
});

export default router;
