import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS IssueDependency (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES Issue(id) ON DELETE CASCADE,
      depends_on_issue_id TEXT NOT NULL REFERENCES Issue(id) ON DELETE CASCADE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(issue_id, depends_on_issue_id)
    );
    CREATE INDEX IF NOT EXISTS idx_issue_dependency_issue ON IssueDependency(issue_id);
    CREATE INDEX IF NOT EXISTS idx_issue_dependency_depends ON IssueDependency(depends_on_issue_id);
  `);
}
