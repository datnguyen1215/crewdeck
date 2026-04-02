import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ApiKey (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_api_key_hash ON ApiKey(key_hash);
  `);
}
