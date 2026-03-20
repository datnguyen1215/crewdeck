import { db } from "../index.js";
import type { ActivityLog, CreateActivityInput, ActivityFilters } from "../../types/entities.js";
import { deserializeJson } from "./utils.js";

type ActivityRow = Omit<ActivityLog, "details"> & { details: string | null };

function fromRow(row: ActivityRow): ActivityLog {
  return {
    ...row,
    details: deserializeJson(row.details),
  };
}

export function listActivity(projectId: string, filters: ActivityFilters = {}): ActivityLog[] {
  const conditions: string[] = ["project_id = ?"];
  const values: unknown[] = [projectId];

  if (filters.issue_id !== undefined) { conditions.push("issue_id = ?"); values.push(filters.issue_id); }
  if (filters.actor_type !== undefined) { conditions.push("actor_type = ?"); values.push(filters.actor_type); }
  if (filters.action !== undefined) { conditions.push("action = ?"); values.push(filters.action); }
  if (filters.since !== undefined) { conditions.push("created_at >= ?"); values.push(filters.since); }

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const sql = `SELECT * FROM ActivityLog WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...values, limit, offset) as ActivityRow[];
  return rows.map(fromRow);
}

export function createActivity(input: CreateActivityInput): ActivityLog {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ActivityLog (id, project_id, issue_id, actor_type, actor_id, action, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.project_id,
    input.issue_id ?? null,
    input.actor_type,
    input.actor_id ?? null,
    input.action,
    input.details !== undefined ? JSON.stringify(input.details) : null
  );
  return (fromRow(db.prepare("SELECT * FROM ActivityLog WHERE id = ?").get(id) as ActivityRow))!;
}
