import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  // Check if provider column already exists
  const columns = db
    .prepare("PRAGMA table_info(AgentConfig)")
    .all() as { name: string }[];
  if (columns.some((c) => c.name === "provider")) return;

  // Add provider column with default 'claude' for existing configs
  db.exec(`ALTER TABLE AgentConfig ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude'`);

  // Drop old unique constraint and create new composite one
  // SQLite doesn't support DROP CONSTRAINT, so we recreate the table
  db.transaction(() => {
    db.exec(`
      CREATE TABLE AgentConfig_new (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'claude',
        model TEXT,
        UNIQUE(agent_id, provider)
      )
    `);

    db.exec(`
      INSERT INTO AgentConfig_new (id, agent_id, provider, model)
      SELECT id, agent_id, provider, model FROM AgentConfig
    `);

    db.exec(`DROP TABLE AgentConfig`);
    db.exec(`ALTER TABLE AgentConfig_new RENAME TO AgentConfig`);
  })();
}
