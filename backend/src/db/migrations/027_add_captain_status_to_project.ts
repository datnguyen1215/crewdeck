import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  const cols = db.pragma("table_info(Project)") as { name: string }[];
  const colNames = new Set(cols.map((c) => c.name));

  if (!colNames.has("captain_status")) {
    db.exec(
      "ALTER TABLE Project ADD COLUMN captain_status TEXT NOT NULL DEFAULT 'idle'",
    );
  }
  if (!colNames.has("captain_status_detail")) {
    db.exec("ALTER TABLE Project ADD COLUMN captain_status_detail TEXT");
  }
  if (!colNames.has("captain_pending_count")) {
    db.exec(
      "ALTER TABLE Project ADD COLUMN captain_pending_count INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!colNames.has("captain_processing_since")) {
    db.exec("ALTER TABLE Project ADD COLUMN captain_processing_since DATETIME");
  }
}
