import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  // Check if provider column exists
  const columns = db.prepare("PRAGMA table_info(AgentConfig)").all() as {
    name: string;
  }[];
  if (!columns.some((c) => c.name === "provider")) return;

  // Get current global provider to decide which configs to keep
  const providerRow = db
    .prepare("SELECT value FROM GlobalConfig WHERE key = ?")
    .get("provider") as { value: string } | undefined;
  const currentProvider = providerRow?.value ?? "claude";

  // For each agent, keep only the config matching the current global provider
  // and discard the other provider's config
  const allConfigs = db
    .prepare("SELECT id, agent_id, provider, model FROM AgentConfig")
    .all() as {
    id: string;
    agent_id: string;
    provider: string;
    model: string | null;
  }[];

  const toKeep = new Set<string>();
  const toRemove: string[] = [];

  // Group by agent_id, keep the one matching current provider
  const byAgent = new Map<string, typeof allConfigs>();
  for (const config of allConfigs) {
    const existing = byAgent.get(config.agent_id);
    if (!existing) {
      byAgent.set(config.agent_id, [config]);
    } else {
      existing.push(config);
    }
  }

  for (const [, configs] of byAgent) {
    if (configs.length === 1) {
      toKeep.add(configs[0].id);
    } else {
      const matching = configs.find((c) => c.provider === currentProvider);
      if (matching) {
        toKeep.add(matching.id);
        for (const c of configs) {
          if (c.id !== matching.id) toRemove.push(c.id);
        }
      } else {
        // Keep the first one if no match for current provider
        toKeep.add(configs[0].id);
        for (let i = 1; i < configs.length; i++) {
          toRemove.push(configs[i].id);
        }
      }
    }
  }

  // Remove configs that don't match
  if (toRemove.length > 0) {
    const deleteStmt = db.prepare("DELETE FROM AgentConfig WHERE id = ?");
    const deleteMany = db.transaction((ids: string[]) => {
      for (const id of ids) deleteStmt.run(id);
    });
    deleteMany(toRemove);
  }

  // Recreate table without provider column
  db.transaction(() => {
    db.exec(`
      CREATE TABLE AgentConfig_new (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL UNIQUE,
        model TEXT
      )
    `);

    db.exec(`
      INSERT INTO AgentConfig_new (id, agent_id, model)
      SELECT id, agent_id, model FROM AgentConfig
    `);

    db.exec(`DROP TABLE AgentConfig`);
    db.exec(`ALTER TABLE AgentConfig_new RENAME TO AgentConfig`);
  })();

  // Replace GlobalConfig 'provider' key with 'default_model'
  db.prepare("DELETE FROM GlobalConfig WHERE key = ?").run("provider");
  db.prepare(
    `INSERT OR IGNORE INTO GlobalConfig (key, value) VALUES (?, ?)`,
  ).run("default_model", "sonnet");
}
