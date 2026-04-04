import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ChatMessageEvent (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES ChatMessage(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_chat_message_event_message ON ChatMessageEvent(message_id);
    CREATE INDEX IF NOT EXISTS idx_chat_message_event_created ON ChatMessageEvent(message_id, created_at);
  `);
}
