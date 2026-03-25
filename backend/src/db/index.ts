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
    db.exec(
      "ALTER TABLE Issue ADD COLUMN chain_depth INTEGER NOT NULL DEFAULT 0",
    );
  }

  // Migration: add memory column to Project if missing.
  if (!projectCols.some((c) => c.name === "memory")) {
    db.exec("ALTER TABLE Project ADD COLUMN memory TEXT");
  }

  // Migration: add admiral_enabled column to Project if missing.
  if (!projectCols.some((c) => c.name === "admiral_enabled")) {
    db.exec(
      "ALTER TABLE Project ADD COLUMN admiral_enabled INTEGER NOT NULL DEFAULT 1",
    );
  }

  // Migration: add max_chain_depth column to Project if missing.
  if (!projectCols.some((c) => c.name === "max_chain_depth")) {
    db.exec(
      "ALTER TABLE Project ADD COLUMN max_chain_depth INTEGER NOT NULL DEFAULT 20",
    );
  }

  // Migration: add agent_timeout_minutes column to Project if missing.
  if (!projectCols.some((c) => c.name === "agent_timeout_minutes")) {
    db.exec(
      "ALTER TABLE Project ADD COLUMN agent_timeout_minutes INTEGER NOT NULL DEFAULT 10",
    );
  }

  // Migration: add auto_merge_enabled column to Project if missing.
  if (!projectCols.some((c) => c.name === "auto_merge_enabled")) {
    db.exec(
      "ALTER TABLE Project ADD COLUMN auto_merge_enabled INTEGER NOT NULL DEFAULT 0",
    );
  }

  // Migration: add admiral_idle_timeout_ms column to Project if missing.
  if (!projectCols.some((c) => c.name === "admiral_idle_timeout_ms")) {
    db.exec("ALTER TABLE Project ADD COLUMN admiral_idle_timeout_ms INTEGER");
  }

  // Migration: add agent_id column to Issue if missing.
  if (!issueCols.some((c) => c.name === "agent_id")) {
    db.exec("ALTER TABLE Issue ADD COLUMN agent_id TEXT");
  }

  // Migration: drop Agent table — agents are now fixed constants in code.
  db.pragma("foreign_keys = OFF");
  db.exec("DROP TABLE IF EXISTS Agent");
  db.exec("DROP INDEX IF EXISTS idx_agent_project");
  db.pragma("foreign_keys = ON");

  // Migration: replace oauth_token/scopes with gh_token/ssh_private_key in GitHubAccount.
  const ghCols = db.pragma("table_info(GitHubAccount)") as { name: string }[];
  if (ghCols.some((c) => c.name === "oauth_token")) {
    db.pragma("foreign_keys = OFF");
    db.exec(`
      CREATE TABLE GitHubAccount_new (
        id TEXT PRIMARY KEY,
        account_name TEXT NOT NULL,
        github_username TEXT NOT NULL,
        gh_token TEXT NOT NULL,
        ssh_private_key TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO GitHubAccount_new (id, account_name, github_username, gh_token, ssh_private_key, created_at)
        SELECT id, account_name, github_username, oauth_token, '', created_at FROM GitHubAccount;
      DROP TABLE GitHubAccount;
      ALTER TABLE GitHubAccount_new RENAME TO GitHubAccount;
    `);
    db.pragma("foreign_keys = ON");
  }

  // Migration: add auto_merge_enabled column to Project if missing.
  if (!projectCols.some((c) => c.name === "auto_merge_enabled")) {
    db.exec(
      "ALTER TABLE Project ADD COLUMN auto_merge_enabled INTEGER NOT NULL DEFAULT 0",
    );
  }

  // Migration: add message_type column to ChatMessage if missing (for older DBs without the column).
  // Only runs if ChatMessage table exists and lacks the column.
  try {
    const chatCols = db.pragma("table_info(ChatMessage)") as { name: string }[];
    if (
      chatCols.length > 0 &&
      !chatCols.some((c) => c.name === "message_type")
    ) {
      db.exec(
        "ALTER TABLE ChatMessage ADD COLUMN message_type TEXT NOT NULL DEFAULT 'chat'",
      );
    }
    // Migration: add images column to ChatMessage if missing.
    if (chatCols.length > 0 && !chatCols.some((c) => c.name === "images")) {
      db.exec("ALTER TABLE ChatMessage ADD COLUMN images TEXT");
    }
  } catch {
    // Table may not exist yet in fresh DBs - schema.sql will create it
  }

  // Migration: fix agent run events where type was mapped to 'system' but data contains 'user' type.
  // This restores the original event type from the stored data.
  db.exec(`
    UPDATE AgentRunEvent
    SET type = json_extract(data, '$.type')
    WHERE type = 'system'
      AND json_extract(data, '$.type') = 'user'
  `);

  // Migration: make AgentRun.issue_id nullable (was NOT NULL in older schema).
  const arCols = db.pragma("table_info(AgentRun)") as {
    name: string;
    notnull: number;
  }[];
  const issueIdCol = arCols.find((c) => c.name === "issue_id");
  if (issueIdCol && issueIdCol.notnull === 1) {
    db.exec(`
      CREATE TABLE AgentRun_new (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES Project(id),
        issue_id TEXT REFERENCES Issue(id),
        agent_id TEXT NOT NULL,
        pid INTEGER,
        status TEXT NOT NULL DEFAULT 'queued',
        exit_code INTEGER,
        cost_usd REAL,
        duration_ms INTEGER,
        started_at DATETIME,
        completed_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO AgentRun_new SELECT * FROM AgentRun;
      DROP TABLE AgentRun;
      ALTER TABLE AgentRun_new RENAME TO AgentRun;
      CREATE INDEX IF NOT EXISTS idx_agent_run_project ON AgentRun(project_id);
      CREATE INDEX IF NOT EXISTS idx_agent_run_issue ON AgentRun(issue_id);
      CREATE INDEX IF NOT EXISTS idx_agent_run_status ON AgentRun(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_agent_run_created ON AgentRun(project_id, created_at);
    `);
  }

  return db;
}

export const db = createDb(config.dbPath);
