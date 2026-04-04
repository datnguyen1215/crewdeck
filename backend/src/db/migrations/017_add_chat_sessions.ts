// NOTE: Migration 035 renames ChatMessage → MonitorMessage and drops ChatSession.
// This file is kept for migration ordering correctness only.
import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  // Create ChatSession table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS ChatSession (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES Project(id) ON DELETE CASCADE,
      title TEXT,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_chat_session_project ON ChatSession(project_id);
    CREATE INDEX IF NOT EXISTS idx_chat_session_status ON ChatSession(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_chat_session_created ON ChatSession(project_id, created_at DESC);
  `);

  // Add session_id to ChatMessage and drop message_type
  const cols = db.pragma("table_info(ChatMessage)") as { name: string }[];
  if (cols.length === 0) return; // table doesn't exist yet

  const hasSessionId = cols.some((c) => c.name === "session_id");
  const hasMessageType = cols.some((c) => c.name === "message_type");

  if (!hasSessionId || hasMessageType) {
    db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE ChatMessage_new (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES Project(id) ON DELETE CASCADE,
            session_id TEXT REFERENCES ChatSession(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
            content TEXT NOT NULL,
            images TEXT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          INSERT INTO ChatMessage_new (id, project_id, role, content, images, created_at)
            SELECT id, project_id, role, content, images, created_at FROM ChatMessage;
          DROP TABLE ChatMessage;
          ALTER TABLE ChatMessage_new RENAME TO ChatMessage;
          CREATE INDEX IF NOT EXISTS idx_chat_message_project ON ChatMessage(project_id);
          CREATE INDEX IF NOT EXISTS idx_chat_message_session ON ChatMessage(session_id);
          CREATE INDEX IF NOT EXISTS idx_chat_message_created ON ChatMessage(project_id, created_at DESC);
        `);
      })();
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }
}
