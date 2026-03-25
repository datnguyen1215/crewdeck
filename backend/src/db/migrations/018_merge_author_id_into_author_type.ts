import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
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
}
