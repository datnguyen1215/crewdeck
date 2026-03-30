import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS GlobalConfig (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Set default provider to claude
  db.prepare(
    `INSERT OR IGNORE INTO GlobalConfig (key, value) VALUES (?, ?)`,
  ).run("provider", "claude");
}
