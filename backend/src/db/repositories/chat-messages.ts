import { db } from "../index.js";
import type {
  ChatMessage,
  ChatMessageRole,
  ChatMessageType,
} from "../../types/entities.js";

interface ChatMessageRow {
  id: string;
  project_id: string;
  role: ChatMessageRole;
  content: string;
  message_type: ChatMessageType;
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
  messageType: ChatMessageType = "chat",
  images: string[] | null = null,
): ChatMessage {
  const id = crypto.randomUUID();
  const imagesJson = images ? JSON.stringify(images) : null;
  db.prepare(
    `INSERT INTO ChatMessage (id, project_id, role, content, message_type, images) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, role, content, messageType, imagesJson);
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
  messageType: ChatMessageType = "chat",
  images: string[] | null = null,
): ChatMessage {
  const imagesJson = images ? JSON.stringify(images) : null;
  db.prepare(
    `INSERT INTO ChatMessage (id, project_id, role, content, message_type, images) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, role, content, messageType, imagesJson);
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

/**
 * Get only chat messages (excludes event-batch messages used for LLM context).
 * Use this for loading conversation history shown in the UI.
 */
export function getChatOnly(projectId: string, limit = 20): ChatMessage[] {
  const rows = db
    .prepare(
      `SELECT * FROM ChatMessage WHERE project_id = ? AND message_type = 'chat' ORDER BY created_at DESC LIMIT ?`,
    )
    .all(projectId, limit) as ChatMessageRow[];
  return rows.map(parseRow);
}

/**
 * Get messages by type (e.g., 'monitor' for monitor history, 'chat' for user conversation).
 */
export function getByType(
  projectId: string,
  messageType: ChatMessageType,
  limit = 20,
): ChatMessage[] {
  const rows = db
    .prepare(
      `SELECT * FROM ChatMessage WHERE project_id = ? AND message_type = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(projectId, messageType, limit) as ChatMessageRow[];
  return rows.map(parseRow);
}

export function deleteByProject(projectId: string): void {
  db.prepare("DELETE FROM ChatMessage WHERE project_id = ?").run(projectId);
}
