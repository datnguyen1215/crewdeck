import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      // Create new table without agent_ids column
      db.exec(`
        CREATE TABLE ProjectKnowledge_new (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES Project(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          category TEXT NOT NULL,
          content TEXT NOT NULL,
          source TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Copy data from old table, deduplicating entries
      // Keep the most recently updated entry for each (project_id, title) pair
      db.exec(`
        INSERT INTO ProjectKnowledge_new (id, project_id, title, category, content, source, created_at, updated_at)
        SELECT id, project_id, title, category, content, source, created_at, updated_at
        FROM (
          SELECT
            id,
            project_id,
            title,
            category,
            content,
            source,
            created_at,
            updated_at,
            ROW_NUMBER() OVER (PARTITION BY project_id, title ORDER BY updated_at DESC, created_at DESC) as rn
          FROM ProjectKnowledge
        )
        WHERE rn = 1;
      `);

      // Drop old table and rename new one
      db.exec(`
        DROP TABLE ProjectKnowledge;
        ALTER TABLE ProjectKnowledge_new RENAME TO ProjectKnowledge;
      `);

      // Recreate indexes
      db.exec(`
        CREATE INDEX idx_project_knowledge_project ON ProjectKnowledge(project_id);
        CREATE INDEX idx_project_knowledge_updated ON ProjectKnowledge(project_id, updated_at DESC, created_at DESC);
      `);
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}
