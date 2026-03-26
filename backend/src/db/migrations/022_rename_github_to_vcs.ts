import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  // Check if migration already applied
  const cols = db.pragma("table_info(VCSAccount)") as { name: string }[];
  if (cols.length > 0) return;

  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      // 1. GitHubAccount → VCSAccount
      db.exec(`
        CREATE TABLE VCSAccount (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL DEFAULT 'github',
          account_name TEXT NOT NULL,
          username TEXT NOT NULL,
          token TEXT NOT NULL,
          ssh_private_key TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO VCSAccount (id, provider, account_name, username, token, ssh_private_key, created_at)
          SELECT id, 'github', account_name, github_username, gh_token, ssh_private_key, created_at
          FROM GitHubAccount;

        DROP TABLE GitHubAccount;
      `);

      // 2. Project.vcs_account_id → Project.vcs_account_id
      db.exec(`
        CREATE TABLE Project_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          max_concurrency INTEGER NOT NULL DEFAULT 1,
          max_chain_depth INTEGER NOT NULL DEFAULT 20,
          agent_timeout_minutes INTEGER NOT NULL DEFAULT 10,
          auto_start INTEGER NOT NULL DEFAULT 0,
          auto_merge INTEGER NOT NULL DEFAULT 0,
          captain_idle_timeout_ms INTEGER,
          memory TEXT,
          model TEXT NOT NULL DEFAULT 'sonnet',
          vcs_account_id TEXT REFERENCES VCSAccount(id) ON DELETE SET NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO Project_new (id, name, description, max_concurrency, max_chain_depth, agent_timeout_minutes, auto_start, auto_merge, captain_idle_timeout_ms, memory, model, vcs_account_id, created_at, updated_at)
          SELECT id, name, description, max_concurrency, max_chain_depth, agent_timeout_minutes, auto_start, auto_merge, captain_idle_timeout_ms, memory, model, vcs_account_id, created_at, updated_at
          FROM Project;

        DROP TABLE Project;
        ALTER TABLE Project_new RENAME TO Project;
      `);

      // 3. Repo.github_url → Repo.repo_url
      db.exec(`
        CREATE TABLE Repo_new (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES Project(id),
          repo_url TEXT NOT NULL,
          name TEXT NOT NULL,
          owner TEXT NOT NULL,
          local_path TEXT NOT NULL,
          default_branch TEXT NOT NULL DEFAULT 'main',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(project_id, repo_url)
        );

        INSERT INTO Repo_new (id, project_id, repo_url, name, owner, local_path, default_branch, created_at)
          SELECT id, project_id, github_url, name, owner, local_path, default_branch, created_at
          FROM Repo;

        DROP TABLE Repo;
        ALTER TABLE Repo_new RENAME TO Repo;
      `);

      // 4. Recreate indexes
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_repo_project ON Repo(project_id);
        CREATE INDEX IF NOT EXISTS idx_issue_project ON Issue(project_id);
        CREATE INDEX IF NOT EXISTS idx_issue_status ON Issue(project_id, status);
        CREATE INDEX IF NOT EXISTS idx_comment_issue ON Comment(issue_id);
        CREATE INDEX IF NOT EXISTS idx_comment_created ON Comment(issue_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_issue_pr_issue ON IssuePR(issue_id);
        CREATE INDEX IF NOT EXISTS idx_activity_project ON ActivityLog(project_id);
        CREATE INDEX IF NOT EXISTS idx_activity_issue ON ActivityLog(issue_id);
        CREATE INDEX IF NOT EXISTS idx_activity_created ON ActivityLog(project_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_env_var_project ON EnvironmentVariable(project_id);
      `);
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}
