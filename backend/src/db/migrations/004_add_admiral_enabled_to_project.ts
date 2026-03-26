import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  const cols = db.pragma("table_info(Project)") as { name: string }[];
  // Skip if already present under original or renamed name (008)
  if (
    !cols.some(
      (c) => c.name === "admiral_enabled" || c.name === "captain_enabled",
    )
  ) {
    db.exec(
      "ALTER TABLE Project ADD COLUMN admiral_enabled INTEGER NOT NULL DEFAULT 1",
    );
  }
}
