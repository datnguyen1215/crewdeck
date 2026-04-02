import { db } from "../index.js";
import type {
  ActivityLog,
  CreateActivityInput,
  ActivityFilters,
} from "../../types/entities.js";
import { deserializeJson } from "./utils.js";
import { getTitlesByIds } from "./issues.js";
import { getCrewMember } from "../../orchestration/crew.js";

type ActivityRow = Omit<ActivityLog, "details"> & { details: string | null };

function getProjectNamesByIds(ids: string[]): Map<string, string> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT id, name FROM Project WHERE id IN (${placeholders})`)
    .all(...ids) as { id: string; name: string }[];
  return new Map(rows.map((r) => [r.id, r.name]));
}

function fromRow(row: ActivityRow): ActivityLog {
  return {
    ...row,
    details: deserializeJson(row.details),
  };
}

export function listActivity(
  projectId: string,
  filters: ActivityFilters = {},
): ActivityLog[] {
  const conditions: string[] = ["project_id = ?"];
  const values: unknown[] = [projectId];

  if (filters.issue_id !== undefined) {
    conditions.push("issue_id = ?");
    values.push(filters.issue_id);
  }
  if (filters.actor_type !== undefined) {
    conditions.push("actor_type = ?");
    values.push(filters.actor_type);
  }
  if (filters.action !== undefined) {
    conditions.push("action = ?");
    values.push(filters.action);
  }
  if (filters.since !== undefined) {
    conditions.push("created_at >= ?");
    values.push(filters.since);
  }

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const sql = `SELECT * FROM ActivityLog WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...values, limit, offset) as ActivityRow[];
  return rows.map(fromRow);
}

/**
 * Enrich activity entries with actor_name and issue_title.
 * Resolves agent names from in-memory crew and issue titles via batch DB lookup.
 *
 * Note: Some entries may not receive an actor_name. Old activity logs may have
 * UUID actor_ids from before the fixed crew migration — they'll display without
 * actor_name.
 */
export function enrichActivityEntries(
  entries: ActivityLog[],
  compact: boolean,
  options?: { projectNames?: boolean },
): Record<string, unknown>[] {
  const agentCache = new Map<string, string | null>();

  const issueIds = Array.from(
    new Set(
      entries.map((e) => e.issue_id).filter((id): id is string => id != null),
    ),
  );
  const issueTitleCache = getTitlesByIds(issueIds);

  const projectIds = options?.projectNames
    ? Array.from(new Set(entries.map((e) => e.project_id)))
    : [];
  const projectNameCache = getProjectNamesByIds(projectIds);

  return entries.map((entry: ActivityLog) => {
    const { details, ...rest } = entry;
    const base: Record<string, unknown> = compact ? rest : entry;

    // Promote display-critical fields to top-level when compact mode strips details
    if (compact && details && typeof details === "object") {
      const d = details as Record<string, unknown>;
      if (entry.action === "issue.status_changed") {
        if (d.from !== undefined) base.from = d.from;
        if (d.to !== undefined) base.to = d.to;
      }
      if (entry.action === "pr.created" && d.pr_number !== undefined) {
        base.pr_number = d.pr_number;
      }
      if (entry.action === "mention.completed" && d.exit_code !== undefined) {
        base.exit_code = d.exit_code;
      }
    }

    const enrichments: Record<string, unknown> = {};

    const agentIdForName =
      entry.actor_type === "agent" && entry.actor_id
        ? entry.actor_id
        : entry.actor_type === "system" &&
            entry.details &&
            typeof (entry.details as Record<string, unknown>).agent_id ===
              "string"
          ? ((entry.details as Record<string, unknown>).agent_id as string)
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

    if (entry.issue_id) {
      const title = issueTitleCache.get(entry.issue_id);
      if (title) enrichments.issue_title = title;
    }

    if (projectNameCache.size > 0) {
      const name = projectNameCache.get(entry.project_id);
      if (name) enrichments.project_name = name;
    }

    return Object.keys(enrichments).length > 0
      ? { ...base, ...enrichments }
      : base;
  });
}

export function listGlobalActivity(filters: ActivityFilters = {}): ActivityLog[] {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.since !== undefined) {
    conditions.push("created_at >= ?");
    values.push(filters.since);
  }

  const limit = Math.min(filters.limit ?? 10, 50);
  const offset = filters.offset ?? 0;

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT * FROM ActivityLog${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...values, limit, offset) as ActivityRow[];
  return rows.map(fromRow);
}

export function createActivity(input: CreateActivityInput): ActivityLog {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ActivityLog (id, project_id, issue_id, actor_type, actor_id, action, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.project_id,
    input.issue_id ?? null,
    input.actor_type,
    input.actor_id ?? null,
    input.action,
    input.details !== undefined ? JSON.stringify(input.details) : null,
  );
  return fromRow(
    db.prepare("SELECT * FROM ActivityLog WHERE id = ?").get(id) as ActivityRow,
  )!;
}
