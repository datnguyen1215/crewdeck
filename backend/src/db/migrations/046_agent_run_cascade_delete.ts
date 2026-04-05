import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE AgentRun_new (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES Project(id) ON DELETE CASCADE,
          issue_id TEXT REFERENCES Issue(id) ON DELETE CASCADE,
          agent_id TEXT NOT NULL,
          pid INTEGER,
          status TEXT NOT NULL DEFAULT 'queued',
          exit_code INTEGER,
          cost_usd REAL,
          duration_ms INTEGER,
          started_at DATETIME,
          completed_at DATETIME,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO AgentRun_new SELECT * FROM AgentRun;
        DROP TABLE AgentRun;
        ALTER TABLE AgentRun_new RENAME TO AgentRun;
        CREATE INDEX IF NOT EXISTS idx_agent_run_project ON AgentRun(project_id);
        CREATE INDEX IF NOT EXISTS idx_agent_run_issue ON AgentRun(issue_id);
        CREATE INDEX IF NOT EXISTS idx_agent_run_status ON AgentRun(project_id, status);
        CREATE INDEX IF NOT EXISTS idx_agent_run_created ON AgentRun(project_id, created_at);
      `);
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}
