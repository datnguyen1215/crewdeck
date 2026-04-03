import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  // Migrate existing per-project configs: pick first non-null model per agent
  const existing = db
    .prepare(
      `SELECT agent_id, model FROM AgentConfig WHERE model IS NOT NULL GROUP BY agent_id`,
    )
    .all() as { agent_id: string; model: string }[];

  // Drop old per-project AgentConfig table
  db.exec(`DROP TABLE IF EXISTS AgentConfig`);

  // Create new global AgentConfig table (no project_id)
  db.exec(`
    CREATE TABLE IF NOT EXISTS AgentConfig (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL UNIQUE,
      model TEXT
    )
  `);

  // Insert migrated configs
  const insert = db.prepare(
    `INSERT OR IGNORE INTO AgentConfig (id, agent_id, model) VALUES (?, ?, ?)`,
  );
  for (const row of existing) {
    insert.run(crypto.randomUUID(), row.agent_id, row.model);
  }
}
