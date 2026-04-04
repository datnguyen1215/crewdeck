import type Database from "better-sqlite3";
import { logger } from "../../logger.js";

/**
 * Migrate existing MonitorMessage rows into ChatMessage rows under each
 * project's monitor chat thread. Keeps MonitorMessage table intact for
 * backward compatibility.
 */
export function run(db: Database.Database): void {
  // Skip if either source or destination tables don't exist
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as { name: string }[];
  const tableNames = new Set(tables.map((t) => t.name));
  if (!tableNames.has("MonitorMessage") || !tableNames.has("ChatMessage")) {
    logger.info("Migration 040: MonitorMessage or ChatMessage table not found, skipping");
    return;
  }

  // Skip if already migrated (no-op if run again)
  const existingRows = db
    .prepare(
      "SELECT COUNT(*) as count FROM ChatMessage cm JOIN ChatThread ct ON cm.thread_id = ct.id WHERE ct.type = 'monitor'",
    )
    .get() as { count: number };
  if (existingRows.count > 0) {
    logger.info(
      `Migration 040: ${existingRows.count} chat messages already exist for monitor threads, skipping`,
    );
    return;
  }

  // Ensure monitor threads exist for all projects that have monitor messages
  db.exec(`
    INSERT OR IGNORE INTO ChatThread (id, project_id, title, type, created_at, updated_at)
    SELECT
      lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
      mm.project_id,
      'Captain Monitor',
      'monitor',
      MIN(mm.created_at),
      MIN(mm.created_at)
    FROM MonitorMessage mm
    GROUP BY mm.project_id
  `);

  // Copy MonitorMessage rows into ChatMessage with appropriate role mapping
  // MonitorMessage role 'user' → ChatMessage role 'event' (monitor user messages are event batches)
  // MonitorMessage role 'assistant' → ChatMessage role 'assistant'
  db.exec(`
    INSERT INTO ChatMessage (id, thread_id, role, content, created_at)
    SELECT
      lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
      ct.id,
      CASE WHEN mm.role = 'user' THEN 'event' ELSE 'assistant' END,
      mm.content,
      mm.created_at
    FROM MonitorMessage mm
    JOIN ChatThread ct ON ct.project_id = mm.project_id AND ct.type = 'monitor'
    ORDER BY mm.created_at ASC
  `);

  const { count: migrated } = db
    .prepare("SELECT COUNT(*) as count FROM ChatMessage cm JOIN ChatThread ct ON cm.thread_id = ct.id WHERE ct.type = 'monitor'")
    .get() as { count: number };
  logger.info(`Migration 040: Migrated ${migrated} monitor messages to chat threads`);
}
