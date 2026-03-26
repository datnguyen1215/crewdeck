import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  const cols = db.pragma("table_info(GitHubAccount)") as { name: string }[];
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
}
