import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type Migration = {
  name: string;
  run: (db: Database.Database) => void;
};

const migrations: Migration[] = [
  {
    name: "001_add_github_account_id_to_project",
    run(db) {
      const cols = db.pragma("table_info(Project)") as { name: string }[];
      if (!cols.some((c) => c.name === "github_account_id")) {
        db.exec(
          `ALTER TABLE Project ADD COLUMN github_account_id TEXT REFERENCES GitHubAccount(id) ON DELETE SET NULL`,
        );
      }
    },
  },
  {
    name: "002_add_chain_depth_to_issue",
    run(db) {
      const cols = db.pragma("table_info(Issue)") as { name: string }[];
      if (!cols.some((c) => c.name === "chain_depth")) {
        db.exec(
          "ALTER TABLE Issue ADD COLUMN chain_depth INTEGER NOT NULL DEFAULT 0",
        );
      }
    },
  },
  {
    name: "003_add_memory_to_project",
    run(db) {
      const cols = db.pragma("table_info(Project)") as { name: string }[];
      if (!cols.some((c) => c.name === "memory")) {
        db.exec("ALTER TABLE Project ADD COLUMN memory TEXT");
      }
    },
  },
  {
    name: "004_add_admiral_enabled_to_project",
    run(db) {
      const cols = db.pragma("table_info(Project)") as { name: string }[];
      // Skip if already present under original or renamed name (008)
      if (
        !cols.some(
          (c) => c.name === "admiral_enabled" || c.name === "captain_enabled",
        )
      ) {
        db.exec(
          "ALTER TABLE Project ADD COLUMN admiral_enabled INTEGER NOT NULL DEFAULT 1",
        );
      }
    },
  },
  {
    name: "005_add_max_chain_depth_to_project",
    run(db) {
      const cols = db.pragma("table_info(Project)") as { name: string }[];
      if (!cols.some((c) => c.name === "max_chain_depth")) {
        db.exec(
          "ALTER TABLE Project ADD COLUMN max_chain_depth INTEGER NOT NULL DEFAULT 20",
        );
      }
    },
  },
  {
    name: "006_add_agent_timeout_minutes_to_project",
    run(db) {
      const cols = db.pragma("table_info(Project)") as { name: string }[];
      if (!cols.some((c) => c.name === "agent_timeout_minutes")) {
        db.exec(
          "ALTER TABLE Project ADD COLUMN agent_timeout_minutes INTEGER NOT NULL DEFAULT 10",
        );
      }
    },
  },
  {
    name: "007_add_admiral_idle_timeout_ms_to_project",
    run(db) {
      const cols = db.pragma("table_info(Project)") as { name: string }[];
      // Skip if already present under original or renamed name (008)
      if (
        !cols.some(
          (c) =>
            c.name === "admiral_idle_timeout_ms" ||
            c.name === "captain_idle_timeout_ms",
        )
      ) {
        db.exec(
          "ALTER TABLE Project ADD COLUMN admiral_idle_timeout_ms INTEGER",
        );
      }
    },
  },
  {
    name: "008_rename_admiral_to_captain_columns",
    run(db) {
      const cols = db.pragma("table_info(Project)") as { name: string }[];
      if (
        cols.some((c) => c.name === "admiral_enabled") &&
        !cols.some((c) => c.name === "captain_enabled")
      ) {
        db.exec(
          "ALTER TABLE Project RENAME COLUMN admiral_enabled TO captain_enabled",
        );
      }
      if (
        cols.some((c) => c.name === "admiral_idle_timeout_ms") &&
        !cols.some((c) => c.name === "captain_idle_timeout_ms")
      ) {
        db.exec(
          "ALTER TABLE Project RENAME COLUMN admiral_idle_timeout_ms TO captain_idle_timeout_ms",
        );
      }
    },
  },
  {
    name: "009_rename_admiral_to_captain_data",
    run(db) {
      // Check if author_id column exists before updating (may not exist in new schemas)
      const cols = db.pragma("table_info(Comment)") as { name: string }[];
      if (cols.some((c) => c.name === "author_id")) {
        db.exec(
          "UPDATE Comment SET author_id = 'captain' WHERE author_id = 'admiral'",
        );
      }
      db.exec(
        "UPDATE AgentRun SET agent_id = 'captain' WHERE agent_id = 'admiral'",
      );
    },
  },
  {
    name: "010_add_agent_id_to_issue",
    run(db) {
      const cols = db.pragma("table_info(Issue)") as { name: string }[];
      if (!cols.some((c) => c.name === "agent_id")) {
        db.exec("ALTER TABLE Issue ADD COLUMN agent_id TEXT");
      }
    },
  },
  {
    name: "011_drop_agent_table",
    run(db) {
      db.pragma("foreign_keys = OFF");
      try {
        db.exec("DROP TABLE IF EXISTS Agent");
        db.exec("DROP INDEX IF EXISTS idx_agent_project");
      } finally {
        db.pragma("foreign_keys = ON");
      }
    },
  },
  {
    name: "012_recreate_github_account_schema",
    run(db) {
      const cols = db.pragma("table_info(GitHubAccount)") as {
        name: string;
      }[];
      if (!cols.some((c) => c.name === "oauth_token")) return;

      db.pragma("foreign_keys = OFF");
      try {
        db.transaction(() => {
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
        })();
      } finally {
        db.pragma("foreign_keys = ON");
      }
    },
  },
  {
    name: "013_add_auto_merge_enabled_to_project",
    run(db) {
      const cols = db.pragma("table_info(Project)") as { name: string }[];
      if (!cols.some((c) => c.name === "auto_merge_enabled")) {
        db.exec(
          "ALTER TABLE Project ADD COLUMN auto_merge_enabled INTEGER NOT NULL DEFAULT 0",
        );
      }
    },
  },
  {
    name: "014_add_message_type_and_images_to_chat_message",
    run(db) {
      try {
        const cols = db.pragma("table_info(ChatMessage)") as {
          name: string;
        }[];
        if (cols.length > 0 && !cols.some((c) => c.name === "message_type")) {
          db.exec(
            "ALTER TABLE ChatMessage ADD COLUMN message_type TEXT NOT NULL DEFAULT 'chat'",
          );
        }
        if (cols.length > 0 && !cols.some((c) => c.name === "images")) {
          db.exec("ALTER TABLE ChatMessage ADD COLUMN images TEXT");
        }
      } catch {
        // Table may not exist yet in fresh DBs — schema.sql will create it
      }
    },
  },
  {
    name: "015_fix_agent_run_event_types",
    run(db) {
      db.exec(`
        UPDATE AgentRunEvent
        SET type = json_extract(data, '$.type')
        WHERE type = 'system'
          AND json_extract(data, '$.type') = 'user'
      `);
    },
  },
  {
    name: "016_make_agent_run_issue_id_nullable",
    run(db) {
      const cols = db.pragma("table_info(AgentRun)") as {
        name: string;
        notnull: number;
      }[];
      const issueIdCol = cols.find((c) => c.name === "issue_id");
      if (!issueIdCol || issueIdCol.notnull !== 1) return;

      db.pragma("foreign_keys = OFF");
      try {
        db.transaction(() => {
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
        })();
      } finally {
        db.pragma("foreign_keys = ON");
      }
    },
  },
  {
    name: "017_add_chat_sessions",
    run(db) {
      // Create ChatSession table if not exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS ChatSession (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES Project(id) ON DELETE CASCADE,
          title TEXT,
          summary TEXT,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_chat_session_project ON ChatSession(project_id);
        CREATE INDEX IF NOT EXISTS idx_chat_session_status ON ChatSession(project_id, status);
        CREATE INDEX IF NOT EXISTS idx_chat_session_created ON ChatSession(project_id, created_at DESC);
      `);

      // Add session_id to ChatMessage and drop message_type
      const cols = db.pragma("table_info(ChatMessage)") as {
        name: string;
      }[];
      if (cols.length === 0) return; // table doesn't exist yet

      const hasSessionId = cols.some((c) => c.name === "session_id");
      const hasMessageType = cols.some((c) => c.name === "message_type");

      if (!hasSessionId || hasMessageType) {
        db.pragma("foreign_keys = OFF");
        try {
          db.transaction(() => {
            db.exec(`
              CREATE TABLE ChatMessage_new (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES Project(id) ON DELETE CASCADE,
                session_id TEXT REFERENCES ChatSession(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                images TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
              );
              INSERT INTO ChatMessage_new (id, project_id, role, content, images, created_at)
                SELECT id, project_id, role, content, images, created_at FROM ChatMessage;
              DROP TABLE ChatMessage;
              ALTER TABLE ChatMessage_new RENAME TO ChatMessage;
              CREATE INDEX IF NOT EXISTS idx_chat_message_project ON ChatMessage(project_id);
              CREATE INDEX IF NOT EXISTS idx_chat_message_session ON ChatMessage(session_id);
              CREATE INDEX IF NOT EXISTS idx_chat_message_created ON ChatMessage(project_id, created_at DESC);
            `);
          })();
        } finally {
          db.pragma("foreign_keys = ON");
        }
      }
    },
  },
  {
    name: "018_merge_author_id_into_author_type",
    run(db) {
      const cols = db.pragma("table_info(Comment)") as { name: string }[];
      if (!cols.some((c) => c.name === "author_id")) return;

      db.pragma("foreign_keys = OFF");
      try {
        db.transaction(() => {
          // Merge author_id into author_type for agent comments
          db.exec(`
            UPDATE Comment
            SET author_type = author_id
            WHERE author_type = 'agent' AND author_id IS NOT NULL
          `);

          // Recreate table without author_id column
          db.exec(`
            CREATE TABLE Comment_new (
              id TEXT PRIMARY KEY,
              issue_id TEXT NOT NULL REFERENCES Issue(id),
              author_type TEXT NOT NULL,
              content TEXT NOT NULL,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO Comment_new (id, issue_id, author_type, content, created_at)
              SELECT id, issue_id, author_type, content, created_at FROM Comment;
            DROP TABLE Comment;
            ALTER TABLE Comment_new RENAME TO Comment;
            CREATE INDEX IF NOT EXISTS idx_comment_issue ON Comment(issue_id);
            CREATE INDEX IF NOT EXISTS idx_comment_created ON Comment(issue_id, created_at);
          `);
        })();
      } finally {
        db.pragma("foreign_keys = ON");
      }
    },
  },
];

function runMigrations(db: Database.Database): void {
  const applied = new Set(
    (
      db.prepare("SELECT name FROM _migrations").all() as { name: string }[]
    ).map((r) => r.name),
  );

  const record = db.prepare("INSERT INTO _migrations (name) VALUES (?)");

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    migration.run(db);
    record.run(migration.name);
  }
}

export function createDb(path: string): Database.Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = readFileSync(join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);

  runMigrations(db);

  return db;
}

export const db = createDb(config.dbPath);
