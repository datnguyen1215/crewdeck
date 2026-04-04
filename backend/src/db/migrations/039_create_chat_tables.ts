import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE ChatThread (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES Project(id) ON DELETE CASCADE,
        title TEXT,
        type TEXT NOT NULL CHECK (type IN ('monitor', 'user')),
        session_id TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE ChatMessage (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES ChatThread(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'event', 'tool')),
        content TEXT NOT NULL,
        metadata TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_chat_thread_project ON ChatThread(project_id);
      CREATE INDEX idx_chat_thread_project_updated ON ChatThread(project_id, updated_at DESC);
      CREATE UNIQUE INDEX idx_chat_thread_one_monitor ON ChatThread(project_id) WHERE type = 'monitor';
      CREATE INDEX idx_chat_message_thread ON ChatMessage(thread_id);
      CREATE INDEX idx_chat_message_thread_created ON ChatMessage(thread_id, created_at ASC);
    `);
  })();
}
