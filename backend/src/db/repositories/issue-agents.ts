import { db } from "../index.js";
import type { IssueAgent, CreateIssueAgentInput, UpdateIssueAgentInput } from "../../types/entities.js";

export function listIssueAgents(issueId: string): IssueAgent[] {
  return db
    .prepare("SELECT * FROM IssueAgent WHERE issue_id = ? ORDER BY created_at ASC")
    .all(issueId) as IssueAgent[];
}

export function listActiveReviewerAgentIds(issueIds: string[]): string[] {
  if (issueIds.length === 0) return [];
  const placeholders = issueIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT DISTINCT agent_id FROM IssueAgent WHERE issue_id IN (${placeholders}) AND role = 'reviewer' AND status = 'active'`
    )
    .all(...issueIds) as Array<{ agent_id: string }>;
  return rows.map((r) => r.agent_id);
}

export function getIssueAgent(id: string): IssueAgent | null {
  return (
    (db.prepare("SELECT * FROM IssueAgent WHERE id = ?").get(id) as IssueAgent) ?? null
  );
}

export function createIssueAgent(input: CreateIssueAgentInput): IssueAgent {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO IssueAgent (id, issue_id, agent_id, role, status, review_order, review_round, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.issue_id,
    input.agent_id,
    input.role,
    input.status ?? "pending",
    input.review_order ?? null,
    input.review_round ?? null,
    input.session_id ?? null
  );
  return getIssueAgent(id)!;
}

export function updateIssueAgent(id: string, input: UpdateIssueAgentInput): IssueAgent {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.review_order !== undefined) { fields.push("review_order = ?"); values.push(input.review_order); }
  if (input.review_round !== undefined) { fields.push("review_round = ?"); values.push(input.review_round); }
  if (input.session_id !== undefined) { fields.push("session_id = ?"); values.push(input.session_id); }

  if (fields.length > 0) {
    fields.push("updated_at = CURRENT_TIMESTAMP");
    db.prepare(`UPDATE IssueAgent SET ${fields.join(", ")} WHERE id = ?`).run(...values, id);
  }

  return getIssueAgent(id)!;
}
