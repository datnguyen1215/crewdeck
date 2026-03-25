import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  const cols = db.pragma("table_info(Project)") as { name: string }[];
  if (!cols.some((c) => c.name === "auto_merge_enabled")) {
    db.exec(
      "ALTER TABLE Project ADD COLUMN auto_merge_enabled INTEGER NOT NULL DEFAULT 0",
    );
  }
}
