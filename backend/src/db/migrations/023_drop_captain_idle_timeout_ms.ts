import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  const cols = db.pragma("table_info(Project)") as { name: string }[];
  const hasCaptainIdleTimeout = cols.some(
    (c) => c.name === "captain_idle_timeout_ms",
  );

  // Skip if column already dropped
  if (!hasCaptainIdleTimeout) return;

  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE Project_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          max_concurrency INTEGER NOT NULL DEFAULT 1,
          max_chain_depth INTEGER NOT NULL DEFAULT 20,
          agent_timeout_minutes INTEGER NOT NULL DEFAULT 10,
          auto_start INTEGER NOT NULL DEFAULT 0,
          auto_merge INTEGER NOT NULL DEFAULT 0,
          memory TEXT,
          model TEXT NOT NULL DEFAULT 'sonnet',
          vcs_account_id TEXT REFERENCES VCSAccount(id) ON DELETE SET NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO Project_new (id, name, description, max_concurrency, max_chain_depth,
          agent_timeout_minutes, auto_start, auto_merge, memory, model,
          vcs_account_id, created_at, updated_at)
        SELECT id, name, description, max_concurrency, max_chain_depth,
          agent_timeout_minutes, auto_start, auto_merge, memory, model,
          vcs_account_id, created_at, updated_at
        FROM Project;
        DROP TABLE Project;
        ALTER TABLE Project_new RENAME TO Project;
      `);
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}
