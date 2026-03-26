import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  try {
    db.exec("DROP TABLE IF EXISTS Agent");
    db.exec("DROP INDEX IF EXISTS idx_agent_project");
  } finally {
    db.pragma("foreign_keys = ON");
  }
}
