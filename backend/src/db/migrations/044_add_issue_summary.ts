import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  const cols = db
    .prepare("PRAGMA table_info(Issue)")
    .all() as { name: string }[];
  const hasSummary = cols.some((c) => c.name === "summary");
  if (!hasSummary) {
    db.exec(
      "ALTER TABLE Issue ADD COLUMN summary TEXT DEFAULT '' NOT NULL;",
    );
  }
}
