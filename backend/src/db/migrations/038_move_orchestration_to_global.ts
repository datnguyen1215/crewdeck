import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  // Seed GlobalConfig defaults (idempotent — works for both fresh and existing databases)
  const existingKeys = db
    .prepare("SELECT key FROM GlobalConfig")
    .all() as { key: string }[];
  const keySet = new Set(existingKeys.map((r) => r.key));

  if (!keySet.has("max_concurrency")) {
    db.prepare(
      "INSERT INTO GlobalConfig (key, value) VALUES ('max_concurrency', '5')",
    ).run();
  }
  if (!keySet.has("max_chain_depth")) {
    db.prepare(
      "INSERT INTO GlobalConfig (key, value) VALUES ('max_chain_depth', '20')",
    ).run();
  }
  if (!keySet.has("agent_timeout_minutes")) {
    db.prepare(
      "INSERT INTO GlobalConfig (key, value) VALUES ('agent_timeout_minutes', '10')",
    ).run();
  }

  // Drop the per-project orchestration columns from existing databases
  const cols = db.pragma("table_info(Project)") as { name: string }[];
  const hasMaxConcurrency = cols.some((c) => c.name === "max_concurrency");
  if (!hasMaxConcurrency) return;

  db.exec("ALTER TABLE Project DROP COLUMN max_concurrency");
  db.exec("ALTER TABLE Project DROP COLUMN max_chain_depth");
  db.exec("ALTER TABLE Project DROP COLUMN agent_timeout_minutes");
}
