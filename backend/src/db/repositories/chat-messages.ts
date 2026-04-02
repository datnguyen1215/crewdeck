import { db } from "../index.js";
import type { ChatMessage, ChatMessageRole } from "../../types/entities.js";

interface ChatMessageRow {
  id: string;
  project_id: string;
  role: ChatMessageRole;
  content: string;
  created_at: string;
}

function parseRow(row: ChatMessageRow): ChatMessage {
  return row;
}

export function create(
  projectId: string,
  role: ChatMessageRole,
  content: string,
): ChatMessage {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ChatMessage (id, project_id, role, content) VALUES (?, ?, ?, ?)`,
  ).run(id, projectId, role, content);
  const row = db
    .prepare("SELECT * FROM ChatMessage WHERE id = ?")
    .get(id) as ChatMessageRow;
  return parseRow(row);
}

export function getByProject(projectId: string, limit = 20): ChatMessage[] {
  const rows = db
    .prepare(
      `SELECT * FROM ChatMessage WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(projectId, limit) as ChatMessageRow[];
  return rows.map(parseRow);
}
