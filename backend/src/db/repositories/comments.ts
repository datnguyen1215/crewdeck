import { db } from "../index.js";
import type { Comment, CreateCommentInput } from "../../types/entities.js";

export function listComments(issueId: string, limit: number = 20): Comment[] {
  // Fetch newest N comments, then reverse to maintain chronological order.
  // This limits token usage while preserving most recent context.
  const comments = db
    .prepare(
      "SELECT * FROM Comment WHERE issue_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?"
    )
    .all(issueId, limit) as Comment[];
  return comments.reverse();
}

export function getComment(id: string): Comment | null {
  return (db.prepare("SELECT * FROM Comment WHERE id = ?").get(id) as Comment) ?? null;
}

export function updateComment(id: string, content: string): Comment | null {
  db.prepare("UPDATE Comment SET content = ? WHERE id = ?").run(content, id);
  return getComment(id);
}

export function deleteComment(id: string): void {
  db.prepare("DELETE FROM Comment WHERE id = ?").run(id);
}

export function createComment(issueId: string, input: CreateCommentInput): Comment {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO Comment (id, issue_id, author_type, content)
     VALUES (?, ?, ?, ?)`
  ).run(id, issueId, input.author_type ?? "user", input.content);
  return getComment(id)!;
}
