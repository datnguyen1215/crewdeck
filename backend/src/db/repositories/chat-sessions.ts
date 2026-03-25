import { db } from "../index.js";
import type { ChatSession, ChatSessionStatus } from "../../types/entities.js";

export function create(projectId: string, title?: string | null): ChatSession {
  const id = crypto.randomUUID();

  // Archive any currently active session for this project
  db.prepare(
    `UPDATE ChatSession SET status = 'archived', updated_at = CURRENT_TIMESTAMP
     WHERE project_id = ? AND status = 'active'`,
  ).run(projectId);

  db.prepare(
    `INSERT INTO ChatSession (id, project_id, title) VALUES (?, ?, ?)`,
  ).run(id, projectId, title ?? null);

  return db
    .prepare("SELECT * FROM ChatSession WHERE id = ?")
    .get(id) as ChatSession;
}

export function getById(id: string): ChatSession | null {
  return (
    (db
      .prepare("SELECT * FROM ChatSession WHERE id = ?")
      .get(id) as ChatSession) ?? null
  );
}

export function getActiveByProject(projectId: string): ChatSession | null {
  return (
    (db
      .prepare(
        "SELECT * FROM ChatSession WHERE project_id = ? AND status = 'active'",
      )
      .get(projectId) as ChatSession) ?? null
  );
}

export function listByProject(projectId: string): ChatSession[] {
  return db
    .prepare(
      "SELECT * FROM ChatSession WHERE project_id = ? ORDER BY created_at DESC",
    )
    .all(projectId) as ChatSession[];
}

export function updateStatus(
  id: string,
  status: ChatSessionStatus,
): ChatSession | null {
  db.prepare(
    "UPDATE ChatSession SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(status, id);
  return getById(id);
}

export function updateTitle(id: string, title: string): ChatSession | null {
  db.prepare(
    "UPDATE ChatSession SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(title, id);
  return getById(id);
}
