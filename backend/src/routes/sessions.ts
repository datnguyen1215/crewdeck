import { Router, type Request } from "express";
import { listSessions } from "../db/repositories/sessions.js";
import { verifyProject, verifySessionOwnership } from "../middleware/ownership.js";
import type { SessionFilters } from "../types/entities.js";

const router = Router({ mergeParams: true });

router.get("/", verifyProject, (req: Request<{ projectId: string }>, res) => {
  const { projectId } = req.params;
  const { status, type, issue_id } = req.query as Record<string, string>;
  const filters: SessionFilters = {};
  if (status) filters.status = status;
  if (type) filters.session_type = type;
  if (issue_id) filters.issue_id = issue_id;

  res.json(listSessions(projectId, filters));
});

router.get("/:sessionId", verifySessionOwnership, (req, res) => {
  res.json(req.session);
});

export default router;
