import type Database from "better-sqlite3";
import { logger } from "../../logger.js";

/**
 * Rename ChatMessage → MonitorMessage and drop ChatSession.
 * Supersedes migration 034 for existing DBs.
 */
export function run(db: Database.Database): void {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as { name: string }[];
  const tableNames = new Set(tables.map((t) => t.name));

  // If MonitorMessage already exists, nothing to do (fresh DB or already migrated)
  if (tableNames.has("MonitorMessage")) return;
  // If ChatMessage doesn't exist, nothing to do
  if (!tableNames.has("ChatMessage")) return;

  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      // Create MonitorMessage with simplified schema
      db.exec(`
        CREATE TABLE MonitorMessage (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES Project(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO MonitorMessage (id, project_id, role, content, created_at)
          SELECT id, project_id, role, content, created_at FROM ChatMessage;
        DROP TABLE ChatMessage;
        CREATE INDEX IF NOT EXISTS idx_monitor_message_project ON MonitorMessage(project_id);
        CREATE INDEX IF NOT EXISTS idx_monitor_message_created ON MonitorMessage(project_id, created_at DESC);
      `);

      // Drop ChatSession if it exists
      if (tableNames.has("ChatSession")) {
        db.exec("DROP TABLE IF EXISTS ChatSession");
        logger.info("Migration 035: Dropped ChatSession table");
      }
    })();
    logger.info("Migration 035: Renamed ChatMessage to MonitorMessage");
  } finally {
    db.pragma("foreign_keys = ON");
  }
}
