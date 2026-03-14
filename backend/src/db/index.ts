import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createDb(path: string): Database.Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = readFileSync(join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);

  // Migrations for existing databases where CREATE TABLE IF NOT EXISTS is a no-op.
  const columns = db.pragma("table_info(IssueAgent)") as { name: string }[];
  if (!columns.some((c) => c.name === "review_round")) {
    db.exec("ALTER TABLE IssueAgent ADD COLUMN review_round INTEGER");
  }

  return db;
}

export const db = createDb(config.dbPath);

// Convenience wrapper for route handlers. Repositories use db.transaction() directly
// so they can compose within a caller-supplied transaction if needed.
export function withTransaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}
