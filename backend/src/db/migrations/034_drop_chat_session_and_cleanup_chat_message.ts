import type Database from "better-sqlite3";
import { logger } from "../../logger.js";

export function run(db: Database.Database): void {
  // Drop ChatSession table if it exists
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='ChatSession'",
    )
    .get();
  if (tables) {
    db.exec("DROP TABLE IF EXISTS ChatSession");
    logger.info("Migration 034: Dropped ChatSession table");
  }

  // Remove session_id and images columns from ChatMessage if they exist
  const cols = db.pragma("table_info(ChatMessage)") as { name: string }[];
  if (cols.length === 0) return;

  const hasSessionId = cols.some((c) => c.name === "session_id");
  const hasImages = cols.some((c) => c.name === "images");

  if (hasSessionId || hasImages) {
    db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE ChatMessage_new (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES Project(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
            content TEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          INSERT INTO ChatMessage_new (id, project_id, role, content, created_at)
            SELECT id, project_id, role, content, created_at FROM ChatMessage;
          DROP TABLE ChatMessage;
          ALTER TABLE ChatMessage_new RENAME TO ChatMessage;
          CREATE INDEX IF NOT EXISTS idx_chat_message_project ON ChatMessage(project_id);
          CREATE INDEX IF NOT EXISTS idx_chat_message_created ON ChatMessage(project_id, created_at DESC);
        `);
      })();
      logger.info(
        "Migration 034: Removed session_id and images columns from ChatMessage",
      );
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }
}
