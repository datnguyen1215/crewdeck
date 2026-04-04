import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  const cols = db
    .prepare("PRAGMA table_info(ApiKey)")
    .all() as { name: string }[];
  const hasScopes = cols.some((c) => c.name === "scopes");
  if (!hasScopes) {
    db.exec("ALTER TABLE ApiKey ADD COLUMN scopes TEXT;");
  }
}
