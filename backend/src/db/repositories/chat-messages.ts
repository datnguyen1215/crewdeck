import { db } from "../index.js";
import type { ChatMessage, ChatMessageRole } from "../../types/entities.js";

export function create(
  projectId: string,
  role: ChatMessageRole,
  content: string
): ChatMessage {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ChatMessage (id, project_id, role, content) VALUES (?, ?, ?, ?)`
  ).run(id, projectId, role, content);
  return db.prepare("SELECT * FROM ChatMessage WHERE id = ?").get(id) as ChatMessage;
}

export function getByProject(projectId: string, limit = 20): ChatMessage[] {
  return db
    .prepare(
      `SELECT * FROM ChatMessage WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(projectId, limit) as ChatMessage[];
}

export function deleteByProject(projectId: string): void {
  db.prepare("DELETE FROM ChatMessage WHERE project_id = ?").run(projectId);
}
