import { db } from "../index.js";
import type { ChatMessage, ChatMessageRole } from "../../types/entities.js";

export function createMessage(
  threadId: string,
  role: ChatMessageRole,
  content: string,
  metadata?: string
): ChatMessage {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ChatMessage (id, thread_id, role, content, metadata)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, threadId, role, content, metadata ?? null);
  return db.prepare("SELECT * FROM ChatMessage WHERE id = ?").get(id) as ChatMessage;
}

export function listMessages(
  threadId: string,
  limit?: number,
  offset?: number
): ChatMessage[] {
  if (limit === undefined) {
    return db
      .prepare("SELECT * FROM ChatMessage WHERE thread_id = ? ORDER BY created_at ASC")
      .all(threadId) as ChatMessage[];
  }
  return db
    .prepare(
      "SELECT * FROM ChatMessage WHERE thread_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?"
    )
    .all(threadId, limit, offset ?? 0) as ChatMessage[];
}

export function getMessageCount(threadId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) as count FROM ChatMessage WHERE thread_id = ?")
    .get(threadId) as { count: number };
  return row.count;
}

export function getLastMessage(threadId: string): ChatMessage | null {
  return (
    (db
      .prepare(
        "SELECT * FROM ChatMessage WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1"
      )
      .get(threadId) as ChatMessage) ?? null
  );
}

export function updateMessage(id: string, content: string): ChatMessage {
  db.prepare("UPDATE ChatMessage SET content = ? WHERE id = ?").run(content, id);
  return db.prepare("SELECT * FROM ChatMessage WHERE id = ?").get(id) as ChatMessage;
}

export function deleteMessagesByThread(threadId: string): void {
  db.prepare("DELETE FROM ChatMessage WHERE thread_id = ?").run(threadId);
}
