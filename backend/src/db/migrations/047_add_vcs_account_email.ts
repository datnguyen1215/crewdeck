import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  db.exec(`ALTER TABLE VCSAccount ADD COLUMN email TEXT`);
}
