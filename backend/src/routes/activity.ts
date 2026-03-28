import { Router, type Request } from "express";
import { listActivity } from "../db/repositories/activity-log.js";
import { getProject } from "../db/repositories/projects.js";
import { getCrewMember } from "../orchestration/crew.js";
import { NotFoundError, ValidationError } from "../middleware/errors.js";
import type { ActivityFilters, ActivityLog } from "../types/entities.js";
import { db } from "../db/index.js";

const router = Router({ mergeParams: true });

router.get("/", (req: Request<{ projectId: string }>, res) => {
  const { projectId } = req.params;
  if (!getProject(projectId)) throw new NotFoundError("Project not found");

  const { issue_id, actor_type, action, since, limit, offset } =
    req.query as Record<string, string>;
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
  const isCompact = (req.query as Record<string, string>).compact === "true";

  // Resolve agent names for display. Old activity logs may have UUID actor_ids
  // from before the fixed crew migration — they'll display without actor_name.
  const agentCache = new Map<string, string | null>();

  // Collect unique issue IDs and batch-lookup issue titles
  const issueIds = Array.from(
    new Set(
      entries.map((e) => e.issue_id).filter((id): id is string => id != null),
    ),
  );
  const issueTitleCache = new Map<string, string>();
  if (issueIds.length > 0) {
    const placeholders = issueIds.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT id, title FROM Issue WHERE id IN (${placeholders})`)
      .all(...issueIds) as { id: string; title: string }[];
    for (const row of rows) {
      issueTitleCache.set(row.id, row.title);
    }
  }

  const enriched = entries.map((entry: ActivityLog) => {
    const { details, ...rest } = entry;
    const base = isCompact ? rest : entry;

    // Build enrichments object
    const enrichments: any = {};

    // Enrich with actor_name. Also handle historical entries where actor_type is
    // still "system" but details.agent_id exists (logged before the fix).
    const agentIdForName =
      entry.actor_type === "agent" && entry.actor_id
        ? entry.actor_id
        : entry.actor_type === "system" &&
            entry.details &&
            typeof (entry.details as any).agent_id === "string"
          ? ((entry.details as any).agent_id as string)
          : null;

    if (agentIdForName) {
      if (!agentCache.has(agentIdForName)) {
        agentCache.set(
          agentIdForName,
          getCrewMember(agentIdForName)?.name ?? null,
        );
      }
      const name = agentCache.get(agentIdForName);
      if (name) enrichments.actor_name = name;
    }

    // Enrich with issue_title
    if (entry.issue_id) {
      const title = issueTitleCache.get(entry.issue_id);
      if (title) enrichments.issue_title = title;
    }

    // Return base with enrichments if any exist
    return Object.keys(enrichments).length > 0
      ? { ...base, ...enrichments }
      : base;
  });

  res.json(enriched);
});

export default router;
