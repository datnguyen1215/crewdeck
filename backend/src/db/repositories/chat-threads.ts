import { db } from "../index.js";
import type { ChatThread, ChatThreadType } from "../../types/entities.js";

export function createThread(
  projectId: string,
  type: ChatThreadType,
  title?: string
): ChatThread {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ChatThread (id, project_id, title, type)
     VALUES (?, ?, ?, ?)`
  ).run(id, projectId, title ?? null, type);
  return getThread(id)!;
}

export function getThread(id: string): ChatThread | null {
  return (
    (db.prepare("SELECT * FROM ChatThread WHERE id = ?").get(id) as ChatThread) ??
    null
  );
}

export function listThreads(projectId: string): ChatThread[] {
  return db
    .prepare("SELECT * FROM ChatThread WHERE project_id = ? ORDER BY updated_at DESC")
    .all(projectId) as ChatThread[];
}

export function updateThread(
  id: string,
  fields: { title?: string; session_id?: string | null }
): ChatThread {
  const parts: string[] = [];
  const values: unknown[] = [];

  if (fields.title !== undefined) {
    parts.push("title = ?");
    values.push(fields.title);
  }
  if (fields.session_id !== undefined) {
    parts.push("session_id = ?");
    values.push(fields.session_id);
  }

  if (parts.length > 0) {
    parts.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);
    db.prepare(
      `UPDATE ChatThread SET ${parts.join(", ")} WHERE id = ?`
    ).run(...values);
  }

  return getThread(id)!;
}

export function deleteThread(id: string): void {
  db.prepare("DELETE FROM ChatThread WHERE id = ?").run(id);
}

export function getOrCreateMonitorThread(projectId: string): ChatThread {
  const existing = db
    .prepare("SELECT * FROM ChatThread WHERE project_id = ? AND type = 'monitor'")
    .get(projectId) as ChatThread | undefined;

  if (existing) return existing;
  return createThread(projectId, "monitor");
}
