import type Database from "better-sqlite3";
import { logger } from "../../logger.js";

export function run(db: Database.Database): void {
  try {
    const cols = db.pragma("table_info(ChatMessage)") as { name: string }[];
    if (cols.length > 0 && !cols.some((c) => c.name === "message_type")) {
      db.exec(
        "ALTER TABLE ChatMessage ADD COLUMN message_type TEXT NOT NULL DEFAULT 'chat'",
      );
    }
    if (cols.length > 0 && !cols.some((c) => c.name === "images")) {
      db.exec("ALTER TABLE ChatMessage ADD COLUMN images TEXT");
    }
  } catch {
    // Table may not exist yet in fresh DBs — schema will create it
    logger.debug("Migration 014 skipped: ChatMessage table not yet available");
  }
}
