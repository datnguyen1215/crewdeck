import { db } from "../index.js";
import type { Session, CreateSessionInput, UpdateSessionInput, SessionFilters } from "../../types/entities.js";

type SessionRow = Omit<Session, "context"> & { context: string | null };

function fromRow(row: SessionRow): Session {
  return {
    ...row,
    context: row.context ? (JSON.parse(row.context) as unknown) : null,
  };
}

export function listSessions(projectId: string, filters: SessionFilters = {}): Session[] {
  const conditions: string[] = ["project_id = ?"];
  const values: unknown[] = [projectId];

  if (filters.status !== undefined) { conditions.push("status = ?"); values.push(filters.status); }
  if (filters.session_type !== undefined) { conditions.push("session_type = ?"); values.push(filters.session_type); }
  if (filters.issue_id !== undefined) { conditions.push("issue_id = ?"); values.push(filters.issue_id); }

  const sql = `SELECT * FROM Session WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`;
  const rows = db.prepare(sql).all(...values) as SessionRow[];
  return rows.map(fromRow);
}

export function getSession(id: string): Session | null {
  const row = db.prepare("SELECT * FROM Session WHERE id = ?").get(id) as SessionRow | undefined;
  return row ? fromRow(row) : null;
}

export function createSession(input: CreateSessionInput): Session {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO Session (id, project_id, session_type, agent_id, issue_id, tmux_session_name, tmux_pane_id, status, context)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.project_id,
    input.session_type,
    input.agent_id ?? null,
    input.issue_id ?? null,
    input.tmux_session_name ?? null,
    input.tmux_pane_id ?? null,
    input.status ?? "idle",
    input.context !== undefined ? JSON.stringify(input.context) : null
  );
  return getSession(id)!;
}

export function listRunningSessions(): Session[] {
  const rows = db.prepare("SELECT * FROM Session WHERE status = 'running'").all() as SessionRow[];
  return rows.map(fromRow);
}

export function updateSession(id: string, input: UpdateSessionInput): Session {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.session_type !== undefined) { fields.push("session_type = ?"); values.push(input.session_type); }
  if (input.agent_id !== undefined) { fields.push("agent_id = ?"); values.push(input.agent_id); }
  if (input.issue_id !== undefined) { fields.push("issue_id = ?"); values.push(input.issue_id); }
  if (input.tmux_session_name !== undefined) { fields.push("tmux_session_name = ?"); values.push(input.tmux_session_name); }
  if (input.tmux_pane_id !== undefined) { fields.push("tmux_pane_id = ?"); values.push(input.tmux_pane_id); }
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.context !== undefined) { fields.push("context = ?"); values.push(JSON.stringify(input.context)); }

  if (fields.length > 0) {
    fields.push("updated_at = CURRENT_TIMESTAMP");
    db.prepare(`UPDATE Session SET ${fields.join(", ")} WHERE id = ?`).run(...values, id);
  }

  return getSession(id)!;
}
