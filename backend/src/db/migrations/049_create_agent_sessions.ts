import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS AgentSession (
      project_id TEXT NOT NULL,
      issue_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_id, issue_id, agent_id)
    );
  `);
}
