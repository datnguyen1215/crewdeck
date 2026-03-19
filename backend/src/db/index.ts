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

  // Migration: add github_account_id column to Project if missing.
  const projectCols = db.pragma("table_info(Project)") as { name: string }[];
  if (!projectCols.some((c) => c.name === "github_account_id")) {
    db.exec(
      `ALTER TABLE Project ADD COLUMN github_account_id TEXT REFERENCES GitHubAccount(id) ON DELETE SET NULL`,
    );
  }

  // Migration: add chain_depth column to Issue if missing (from legacy schema).
  const issueCols = db.pragma("table_info(Issue)") as { name: string }[];
  if (!issueCols.some((c) => c.name === "chain_depth")) {
    db.exec("ALTER TABLE Issue ADD COLUMN chain_depth INTEGER NOT NULL DEFAULT 0");
  }

  return db;
}

export const db = createDb(config.dbPath);

// Convenience wrapper for route handlers. Repositories use db.transaction() directly
// so they can compose within a caller-supplied transaction if needed.
export function withTransaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}
