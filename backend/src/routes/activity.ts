import { Router } from "express";
import { listActivity } from "../db/repositories/activity-log.js";
import { getProject } from "../db/repositories/projects.js";
import { NotFoundError } from "../middleware/errors.js";
import type { ActivityFilters } from "../types/entities.js";

const router = Router({ mergeParams: true });

router.get("/", (req, res) => {
  const { projectId } = req.params;
  if (!getProject(projectId)) throw new NotFoundError("Project not found");

  const { issue_id, actor_type, action, since, limit, offset } = req.query as Record<string, string>;
  const filters: ActivityFilters = {};
  if (issue_id) filters.issue_id = issue_id;
  if (actor_type) filters.actor_type = actor_type;
  if (action) filters.action = action;
  if (since) filters.since = since;
  if (limit) filters.limit = parseInt(limit, 10);
  if (offset) filters.offset = parseInt(offset, 10);

  res.json(listActivity(projectId, filters));
});

export default router;
