import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  // Add model column to Project table
  const cols = db.pragma("table_info(Project)") as { name: string }[];
  if (!cols.some((c) => c.name === "model")) {
    db.exec(
      `ALTER TABLE Project ADD COLUMN model TEXT NOT NULL DEFAULT 'sonnet'`,
    );
  }

  // Create AgentConfig table for per-agent model overrides
  db.exec(`
    CREATE TABLE IF NOT EXISTS AgentConfig (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES Project(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      model TEXT,
      UNIQUE(project_id, agent_id)
    )
  `);
}
