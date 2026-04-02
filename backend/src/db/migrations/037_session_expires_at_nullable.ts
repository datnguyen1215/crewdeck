import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  db.exec(`
    CREATE TABLE Session_new (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES AdminUser(id) ON DELETE CASCADE
    );

    INSERT INTO Session_new SELECT * FROM Session;

    DROP TABLE Session;
    ALTER TABLE Session_new RENAME TO Session;
  `);
}
