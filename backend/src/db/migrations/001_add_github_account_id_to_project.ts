import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  const cols = db.pragma("table_info(Project)") as { name: string }[];
  if (!cols.some((c) => c.name === "vcs_account_id")) {
    db.exec(
      `ALTER TABLE Project ADD COLUMN vcs_account_id TEXT REFERENCES GitHubAccount(id) ON DELETE SET NULL`,
    );
  }
}
