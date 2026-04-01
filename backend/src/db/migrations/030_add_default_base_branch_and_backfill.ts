import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  db.exec(`
    ALTER TABLE Project ADD COLUMN default_base_branch TEXT NOT NULL DEFAULT 'main';
    UPDATE Issue SET base_branch = 'main' WHERE base_branch IS NULL;
  `);
}
