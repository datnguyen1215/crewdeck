import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  const cols = db.pragma("table_info(Issue)") as { name: string }[];
  if (!cols.some((c) => c.name === "agent_id")) {
    db.exec("ALTER TABLE Issue ADD COLUMN agent_id TEXT");
  }
}
