import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  const cols = db.pragma("table_info(Project)") as { name: string }[];
  const colNames = new Set(cols.map((c) => c.name));

  if (!colNames.has("auto_start")) {
    db.exec("ALTER TABLE Project ADD COLUMN auto_start INTEGER NOT NULL DEFAULT 0");
  }
  if (!colNames.has("auto_merge")) {
    db.exec("ALTER TABLE Project ADD COLUMN auto_merge INTEGER NOT NULL DEFAULT 0");
  }
}
