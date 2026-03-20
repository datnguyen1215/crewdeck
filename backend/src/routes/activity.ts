import { Router, type Request } from "express";
import { listActivity } from "../db/repositories/activity-log.js";
import { getProject } from "../db/repositories/projects.js";
import { getCrewMember } from "../agents/crew.js";
import { NotFoundError, ValidationError } from "../middleware/errors.js";
import type { ActivityFilters, ActivityLog } from "../types/entities.js";

const router = Router({ mergeParams: true });

router.get("/", (req: Request<{ projectId: string }>, res) => {
  const { projectId } = req.params;
  if (!getProject(projectId)) throw new NotFoundError("Project not found");

  const { issue_id, actor_type, action, since, limit, offset } = req.query as Record<string, string>;
  const filters: ActivityFilters = {};
  if (issue_id) filters.issue_id = issue_id;
  if (actor_type) filters.actor_type = actor_type;
  if (action) filters.action = action;
  if (since) {
    const d = new Date(since);
    if (isNaN(d.getTime())) {
      throw new ValidationError("since must be a valid date");
    }
    filters.since = d.toISOString().slice(0, 19).replace("T", " ");
  }
  if (limit) {
    const parsed = parseInt(limit, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new ValidationError("limit must be a non-negative integer");
    }
    filters.limit = Math.min(parsed, 500);
  }
  if (offset) {
    const parsed = parseInt(offset, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new ValidationError("offset must be a non-negative integer");
    }
    filters.offset = parsed;
  }

  const entries = listActivity(projectId, filters);

  // Resolve agent names for display. Old activity logs may have UUID actor_ids
  // from before the fixed crew migration — they'll display without actor_name.
  const agentCache = new Map<string, string | null>();
  const enriched = entries.map((entry: ActivityLog) => {
    if (entry.actor_type === 'agent' && entry.actor_id) {
      if (!agentCache.has(entry.actor_id)) {
        agentCache.set(entry.actor_id, getCrewMember(entry.actor_id)?.name ?? null);
      }
      const name = agentCache.get(entry.actor_id);
      if (name) return { ...entry, actor_name: name };
    }
    return entry;
  });

  res.json(enriched);
});

export default router;
