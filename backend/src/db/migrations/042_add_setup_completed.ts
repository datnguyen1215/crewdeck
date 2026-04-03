import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  db.exec("ALTER TABLE AdminUser ADD COLUMN setup_completed INTEGER DEFAULT 0");
}
