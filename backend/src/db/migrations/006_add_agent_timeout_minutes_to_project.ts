import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  const cols = db.pragma("table_info(Project)") as { name: string }[];
  if (!cols.some((c) => c.name === "agent_timeout_minutes")) {
    db.exec(
      "ALTER TABLE Project ADD COLUMN agent_timeout_minutes INTEGER NOT NULL DEFAULT 10",
    );
  }
}
