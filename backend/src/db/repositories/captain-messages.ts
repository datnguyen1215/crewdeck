import { db } from "../index.js";
import type { CaptainMessage, CreateCaptainMessageInput } from "../../types/entities.js";

export function listCaptainMessages(projectId: string): CaptainMessage[] {
  const rows = db
    .prepare("SELECT * FROM CaptainMessage WHERE project_id = ? ORDER BY created_at ASC, rowid ASC")
    .all(projectId) as CaptainMessage[];
  return rows.map(deserialize);
}

export function getCaptainMessage(id: string): CaptainMessage | null {
  const row = db.prepare("SELECT * FROM CaptainMessage WHERE id = ?").get(id) as CaptainMessage | undefined;
  return row ? deserialize(row) : null;
}

export function createCaptainMessage(
  projectId: string,
  input: CreateCaptainMessageInput,
): CaptainMessage {
  const id = crypto.randomUUID();
  const authorId = input.author_id ?? null;
  const contextJson = input.context ? JSON.stringify(input.context) : null;
  db.prepare(
    `INSERT INTO CaptainMessage (id, project_id, author_type, author_id, content, context)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, input.author_type, authorId, input.content, contextJson);
  return {
    id,
    project_id: projectId,
    author_type: input.author_type,
    author_id: authorId,
    content: input.content,
    context: input.context ?? null,
    created_at: new Date().toISOString(),
  };
}

function deserialize(row: CaptainMessage): CaptainMessage {
  return {
    ...row,
    context: typeof row.context === "string" ? JSON.parse(row.context) : row.context ?? null,
  };
}
