import { db } from "../index.js";
import type { IssuePR, CreateIssuePRInput, UpdateIssuePRInput } from "../../types/entities.js";

export function listIssuePRs(issueId: string): IssuePR[] {
  return db
    .prepare("SELECT * FROM IssuePR WHERE issue_id = ? ORDER BY created_at ASC")
    .all(issueId) as IssuePR[];
}

export function getIssuePR(id: string): IssuePR | null {
  return (db.prepare("SELECT * FROM IssuePR WHERE id = ?").get(id) as IssuePR) ?? null;
}

export function createIssuePR(input: CreateIssuePRInput): IssuePR {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO IssuePR (id, issue_id, repo_id, pr_number, pr_url, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.issue_id,
    input.repo_id,
    input.pr_number,
    input.pr_url,
    input.status ?? "open"
  );
  return getIssuePR(id)!;
}

export function updateIssuePR(id: string, input: UpdateIssuePRInput): IssuePR {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.pr_url !== undefined) { fields.push("pr_url = ?"); values.push(input.pr_url); }

  if (fields.length > 0) {
    fields.push("updated_at = CURRENT_TIMESTAMP");
    db.prepare(`UPDATE IssuePR SET ${fields.join(", ")} WHERE id = ?`).run(...values, id);
  }

  return getIssuePR(id)!;
}
