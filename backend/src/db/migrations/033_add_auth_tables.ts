import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS AdminUser (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS Session (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES AdminUser(id) ON DELETE CASCADE
    );
  `);
}
