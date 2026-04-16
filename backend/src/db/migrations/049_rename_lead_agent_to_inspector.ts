import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  db.exec(`UPDATE AgentConfig SET agent_id = 'inspector' WHERE agent_id = 'lead'`);
}
