import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  // Check if author_id column exists before updating (may not exist in new schemas)
  const cols = db.pragma("table_info(Comment)") as { name: string }[];
  if (cols.some((c) => c.name === "author_id")) {
    db.exec(
      "UPDATE Comment SET author_id = 'captain' WHERE author_id = 'admiral'",
    );
  }
  db.exec(
    "UPDATE AgentRun SET agent_id = 'captain' WHERE agent_id = 'admiral'",
  );
}
