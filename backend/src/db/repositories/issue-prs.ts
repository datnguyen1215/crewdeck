import { db } from "../index.js";
import type { IssuePR, CreateIssuePRInput, UpdateIssuePRInput } from "../../types/entities.js";
import { buildAndRunUpdate } from "./utils.js";

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
  buildAndRunUpdate("IssuePR", id, input);
  return getIssuePR(id)!;
}
