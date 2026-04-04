import { db } from "../index.js";
import type { ChatMessageEvent, ChatMessageEventType } from "../../types/entities.js";

interface ChatMessageEventRow {
  id: string;
  message_id: string;
  type: string;
  data: string;
  created_at: string;
}

function parseRow(row: ChatMessageEventRow): ChatMessageEvent {
  return {
    id: row.id,
    message_id: row.message_id,
    type: row.type as ChatMessageEventType,
    data: JSON.parse(row.data),
    created_at: row.created_at,
  };
}

export function createEvent(
  messageId: string,
  type: ChatMessageEventType,
  data: unknown,
): void {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ChatMessageEvent (id, message_id, type, data) VALUES (?, ?, ?, ?)`,
  ).run(id, messageId, type, JSON.stringify(data));
}

export function listEvents(messageId: string): ChatMessageEvent[] {
  const rows = db
    .prepare("SELECT * FROM ChatMessageEvent WHERE message_id = ? ORDER BY created_at ASC")
    .all(messageId) as ChatMessageEventRow[];
  return rows.map(parseRow);
}
