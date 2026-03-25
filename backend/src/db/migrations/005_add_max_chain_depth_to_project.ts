import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  const cols = db.pragma("table_info(Project)") as { name: string }[];
  if (!cols.some((c) => c.name === "max_chain_depth")) {
    db.exec(
      "ALTER TABLE Project ADD COLUMN max_chain_depth INTEGER NOT NULL DEFAULT 20",
    );
  }
}
