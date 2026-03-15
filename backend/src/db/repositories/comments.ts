import { db } from "../index.js";
import type { Comment, CreateCommentInput } from "../../types/entities.js";

export function listComments(issueId: string): Comment[] {
  return db
    .prepare("SELECT * FROM Comment WHERE issue_id = ? ORDER BY created_at ASC, id ASC")
    .all(issueId) as Comment[];
}

export function getComment(id: string): Comment | null {
  return (db.prepare("SELECT * FROM Comment WHERE id = ?").get(id) as Comment) ?? null;
}

export function createComment(issueId: string, input: CreateCommentInput): Comment {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO Comment (id, issue_id, author_type, author_id, content)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    id,
    issueId,
    input.author_type ?? "user",
    input.author_id ?? null,
    input.content
  );
  return getComment(id)!;
}
