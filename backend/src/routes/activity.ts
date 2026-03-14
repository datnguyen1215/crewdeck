import { Router, type Request } from "express";
import { listActivity } from "../db/repositories/activity-log.js";
import { getProject } from "../db/repositories/projects.js";
import { NotFoundError } from "../middleware/errors.js";
import type { ActivityFilters } from "../types/entities.js";

const router = Router({ mergeParams: true });

router.get("/", (req: Request<{ projectId: string }>, res) => {
  const { projectId } = req.params;
  if (!getProject(projectId)) throw new NotFoundError("Project not found");

  const { issue_id, actor_type, action, since, limit, offset } = req.query as Record<string, string>;
  const filters: ActivityFilters = {};
  if (issue_id) filters.issue_id = issue_id;
  if (actor_type) filters.actor_type = actor_type;
  if (action) filters.action = action;
  if (since) filters.since = since;
  if (limit) {
    const parsed = parseInt(limit, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "limit must be a non-negative integer" } });
      return;
    }
    filters.limit = Math.min(parsed, 500);
  }
  if (offset) {
    const parsed = parseInt(offset, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "offset must be a non-negative integer" } });
      return;
    }
    filters.offset = parsed;
  }

  res.json(listActivity(projectId, filters));
});

export default router;
