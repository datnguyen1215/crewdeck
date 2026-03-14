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

  // Migration: rebuild IssueAgent if it has the old UNIQUE constraint (missing review_round).
  // SQLite can't ALTER constraints, so we rebuild the table.
  const columns = db.pragma("table_info(IssueAgent)") as { name: string }[];
  if (!columns.some((c) => c.name === "review_round")) {
    db.pragma("foreign_keys = OFF");
    db.transaction(() => {
      db.exec(`
        ALTER TABLE IssueAgent RENAME TO IssueAgent_old;

        CREATE TABLE IssueAgent (
          id TEXT PRIMARY KEY,
          issue_id TEXT NOT NULL REFERENCES Issue(id),
          agent_id TEXT NOT NULL REFERENCES Agent(id),
          role TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          review_order INTEGER,
          review_round INTEGER,
          session_id TEXT REFERENCES Session(id),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(issue_id, agent_id, role, review_round)
        );

        INSERT INTO IssueAgent (id, issue_id, agent_id, role, status, review_order, session_id, created_at, updated_at)
          SELECT id, issue_id, agent_id, role, status, review_order, session_id, created_at, updated_at
          FROM IssueAgent_old;

        DROP TABLE IssueAgent_old;

        CREATE INDEX IF NOT EXISTS idx_issue_agent_issue ON IssueAgent(issue_id);
        CREATE INDEX IF NOT EXISTS idx_issue_agent_agent ON IssueAgent(agent_id);
      `);
    })();
    db.pragma("foreign_keys = ON");
  }

  return db;
}

export const db = createDb(config.dbPath);

// Convenience wrapper for route handlers. Repositories use db.transaction() directly
// so they can compose within a caller-supplied transaction if needed.
export function withTransaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}
