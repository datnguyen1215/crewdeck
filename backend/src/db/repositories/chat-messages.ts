import { db } from "../index.js";
import type { ChatMessage, ChatMessageRole } from "../../types/entities.js";

interface ChatMessageRow {
  id: string;
  project_id: string;
  session_id: string | null;
  role: ChatMessageRole;
  content: string;
  images: string | null;
  created_at: string;
}

function parseRow(row: ChatMessageRow): ChatMessage {
  return {
    ...row,
    images: row.images ? JSON.parse(row.images) : null,
  };
}

export function create(
  projectId: string,
  role: ChatMessageRole,
  content: string,
  sessionId: string | null = null,
  images: string[] | null = null,
): ChatMessage {
  const id = crypto.randomUUID();
  const imagesJson = images ? JSON.stringify(images) : null;
  db.prepare(
    `INSERT INTO ChatMessage (id, project_id, session_id, role, content, images) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, sessionId, role, content, imagesJson);
  const row = db
    .prepare("SELECT * FROM ChatMessage WHERE id = ?")
    .get(id) as ChatMessageRow;
  return parseRow(row);
}

/**
 * Create a message with a pre-generated ID (for image storage).
 */
export function createWithId(
  id: string,
  projectId: string,
  role: ChatMessageRole,
  content: string,
  sessionId: string | null = null,
  images: string[] | null = null,
): ChatMessage {
  const imagesJson = images ? JSON.stringify(images) : null;
  db.prepare(
    `INSERT INTO ChatMessage (id, project_id, session_id, role, content, images) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, sessionId, role, content, imagesJson);
  const row = db
    .prepare("SELECT * FROM ChatMessage WHERE id = ?")
    .get(id) as ChatMessageRow;
  return parseRow(row);
}

export function getBySession(sessionId: string, limit = 100): ChatMessage[] {
  const rows = db
    .prepare(
      `SELECT * FROM ChatMessage WHERE session_id = ? ORDER BY created_at ASC LIMIT ?`,
    )
    .all(sessionId, limit) as ChatMessageRow[];
  return rows.map(parseRow);
}

export function getByProject(projectId: string, limit = 20): ChatMessage[] {
  const rows = db
    .prepare(
      `SELECT * FROM ChatMessage WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(projectId, limit) as ChatMessageRow[];
  return rows.map(parseRow);
}

export function deleteByProject(projectId: string): void {
  db.prepare("DELETE FROM ChatMessage WHERE project_id = ?").run(projectId);
}
