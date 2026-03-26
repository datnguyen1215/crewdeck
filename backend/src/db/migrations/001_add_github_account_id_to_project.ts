import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  const cols = db.pragma("table_info(Project)") as { name: string }[];
  // Skip if vcs_account_id exists (fresh database with post-migration-022 schema)
  if (cols.some((c) => c.name === "vcs_account_id")) return;
  // Add github_account_id for old databases (will be renamed later by migration 022)
  if (!cols.some((c) => c.name === "github_account_id")) {
    db.exec(
      `ALTER TABLE Project ADD COLUMN github_account_id TEXT REFERENCES GitHubAccount(id) ON DELETE SET NULL`,
    );
  }
}
