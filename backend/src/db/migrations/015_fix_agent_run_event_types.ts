import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  db.exec(`
    UPDATE AgentRunEvent
    SET type = json_extract(data, '$.type')
    WHERE type = 'system'
      AND json_extract(data, '$.type') = 'user'
  `);
}
