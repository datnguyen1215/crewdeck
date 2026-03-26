import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  const cols = db.pragma("table_info(Project)") as { name: string }[];
  if (
    cols.some((c) => c.name === "admiral_enabled") &&
    !cols.some((c) => c.name === "captain_enabled")
  ) {
    db.exec(
      "ALTER TABLE Project RENAME COLUMN admiral_enabled TO captain_enabled",
    );
  }
  if (
    cols.some((c) => c.name === "admiral_idle_timeout_ms") &&
    !cols.some((c) => c.name === "captain_idle_timeout_ms")
  ) {
    db.exec(
      "ALTER TABLE Project RENAME COLUMN admiral_idle_timeout_ms TO captain_idle_timeout_ms",
    );
  }
}
