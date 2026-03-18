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

        INSERT INTO IssueAgent (id, issue_id, agent_id, role, status, review_order, review_round, session_id, created_at, updated_at)
          SELECT ia.id, ia.issue_id, ia.agent_id, ia.role, ia.status, ia.review_order,
            CASE ia.role WHEN 'worker' THEN 0 ELSE i.current_review_round END,
            ia.session_id, ia.created_at, ia.updated_at
          FROM IssueAgent_old ia
          LEFT JOIN Issue i ON i.id = ia.issue_id;

        DROP TABLE IssueAgent_old;

        CREATE INDEX IF NOT EXISTS idx_issue_agent_issue ON IssueAgent(issue_id);
        CREATE INDEX IF NOT EXISTS idx_issue_agent_agent ON IssueAgent(agent_id);
      `);
    })();
    db.pragma("foreign_keys = ON");
  }

  // Migration: add github_account_id column to Project if missing.
  const projectCols = db.pragma("table_info(Project)") as { name: string }[];
  if (!projectCols.some((c) => c.name === "github_account_id")) {
    db.exec(
      `ALTER TABLE Project ADD COLUMN github_account_id TEXT REFERENCES GitHubAccount(id) ON DELETE SET NULL`,
    );
  }

  // Migration: rename role→title, add description, drop expertise & can_review from Agent.
  const agentCols = db.pragma("table_info(Agent)") as { name: string }[];
  if (agentCols.some((c) => c.name === "role")) {
    db.pragma("foreign_keys = OFF");
    db.transaction(() => {
      db.exec(`
        ALTER TABLE Agent RENAME TO Agent_old;

        CREATE TABLE Agent (
          id TEXT PRIMARY KEY,
          crew_id TEXT NOT NULL REFERENCES Crew(id),
          name TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          system_prompt TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO Agent (id, crew_id, name, title, description, system_prompt, created_at, updated_at)
          SELECT id, crew_id, name, role, NULL, system_prompt, created_at, updated_at
          FROM Agent_old;

        DROP TABLE Agent_old;

        CREATE INDEX IF NOT EXISTS idx_agent_crew ON Agent(crew_id);
      `);
    })();
    db.pragma("foreign_keys = ON");
  }

  // Migration: add is_captain column to Agent if missing.
  const agentCols2 = db.pragma("table_info(Agent)") as { name: string }[];
  if (!agentCols2.some((c) => c.name === "is_captain")) {
    db.exec(
      "ALTER TABLE Agent ADD COLUMN is_captain INTEGER NOT NULL DEFAULT 0",
    );
  }

  // Migration: add status column to Agent if missing.
  const agentCols3 = db.pragma("table_info(Agent)") as { name: string }[];
  if (!agentCols3.some((c) => c.name === "status")) {
    db.exec(
      "ALTER TABLE Agent ADD COLUMN status TEXT NOT NULL DEFAULT 'idle'",
    );
  }

  // Migration: fix broken FK references caused by table renames (Agent_old, Issue_rebuild, etc.).
  // SQLite auto-updates FK refs when a table is renamed, leaving dangling references after
  // the renamed table is dropped. Fix by checking all table DDLs for stale references.
  const allDdls = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL",
    )
    .all() as { sql: string }[];
  const hasBrokenFks = allDdls.some(
    (r) => r.sql.includes("Agent_old") || r.sql.includes("_rebuild"),
  );
  if (hasBrokenFks) {
    db.pragma("foreign_keys = OFF");
    db.transaction(() => {
      // Save data from all tables that need rebuilding
      db.exec(`
        CREATE TABLE _tmp_Issue AS SELECT * FROM Issue;
        CREATE TABLE _tmp_Comment AS SELECT * FROM Comment;
        CREATE TABLE _tmp_Session AS SELECT * FROM Session;
        CREATE TABLE _tmp_IssueAgent AS SELECT * FROM IssueAgent;
        CREATE TABLE _tmp_IssuePR AS SELECT * FROM IssuePR;
        CREATE TABLE _tmp_ActivityLog AS SELECT * FROM ActivityLog;
        CREATE TABLE _tmp_CaptainHistory AS SELECT * FROM CaptainHistory;
        CREATE TABLE _tmp_CaptainMessage AS SELECT * FROM CaptainMessage;

        -- Drop tables in reverse dependency order
        DROP TABLE IF EXISTS ActivityLog;
        DROP TABLE IF EXISTS CaptainHistory;
        DROP TABLE IF EXISTS CaptainMessage;
        DROP TABLE IF EXISTS IssuePR;
        DROP TABLE IF EXISTS IssueAgent;
        DROP TABLE IF EXISTS Comment;
        DROP TABLE IF EXISTS Session;
        DROP TABLE IF EXISTS Issue;
      `);

      // Recreate from schema (these are clean definitions with correct FK refs)
      db.exec(schema);

      // INSERT OR IGNORE is safe: schema constraints haven't changed, only FK target names were fixed.
      db.exec(`
        INSERT OR IGNORE INTO Issue SELECT * FROM _tmp_Issue;
        INSERT OR IGNORE INTO Comment SELECT * FROM _tmp_Comment;
        INSERT OR IGNORE INTO Session SELECT * FROM _tmp_Session;
        INSERT OR IGNORE INTO IssueAgent SELECT * FROM _tmp_IssueAgent;
        INSERT OR IGNORE INTO IssuePR SELECT * FROM _tmp_IssuePR;
        INSERT OR IGNORE INTO ActivityLog SELECT * FROM _tmp_ActivityLog;
        INSERT OR IGNORE INTO CaptainHistory SELECT * FROM _tmp_CaptainHistory;
        INSERT OR IGNORE INTO CaptainMessage SELECT * FROM _tmp_CaptainMessage;

        DROP TABLE _tmp_Issue;
        DROP TABLE _tmp_Comment;
        DROP TABLE _tmp_Session;
        DROP TABLE _tmp_IssueAgent;
        DROP TABLE _tmp_IssuePR;
        DROP TABLE _tmp_ActivityLog;
        DROP TABLE _tmp_CaptainHistory;
        DROP TABLE _tmp_CaptainMessage;
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
