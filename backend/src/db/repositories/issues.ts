import { db } from "../index.js";
import type {
  Issue,
  IssueWithDetails,
  CreateIssueInput,
  UpdateIssueInput,
  IssueFilters,
} from "../../types/entities.js";
import { listComments } from "./comments.js";
import { listIssueAgents } from "./issue-agents.js";
import { listIssuePRs } from "./issue-prs.js";
import { listActivity } from "./activity-log.js";

export function listIssues(projectId: string, filters: IssueFilters = {}): Issue[] {
  const conditions: string[] = ["project_id = ?"];
  const values: unknown[] = [projectId];

  if (filters.status?.length) {
    const placeholders = filters.status.map(() => "?").join(", ");
    conditions.push(`status IN (${placeholders})`);
    values.push(...filters.status);
  }

  if (filters.assigned_agent_id !== undefined) {
    conditions.push("assigned_agent_id = ?");
    values.push(filters.assigned_agent_id);
  }

  if (filters.created_by !== undefined) {
    conditions.push("created_by = ?");
    values.push(filters.created_by);
  }

  // Runtime allowlist — TypeScript union types are erased at runtime, so without this
  // an API layer that passes raw query params would be vulnerable to SQL injection.
  const SORT_COLS = ["priority", "created_at", "updated_at"] as const;
  const ORDERS = ["asc", "desc"] as const;
  const sortCol = SORT_COLS.includes(filters.sort as (typeof SORT_COLS)[number])
    ? filters.sort!
    : "created_at";
  const order = ORDERS.includes(filters.order as (typeof ORDERS)[number])
    ? filters.order!
    : "desc";
  const sql = `SELECT * FROM Issue WHERE ${conditions.join(" AND ")} ORDER BY ${sortCol} ${order}`;

  return db.prepare(sql).all(...values) as Issue[];
}

export function getIssue(id: string): Issue | null {
  return (db.prepare("SELECT * FROM Issue WHERE id = ?").get(id) as Issue) ?? null;
}

export function getIssueWithDetails(id: string): IssueWithDetails | null {
  const issue = getIssue(id);
  if (!issue) return null;
  return {
    ...issue,
    comments: listComments(id),
    agents: listIssueAgents(id),
    prs: listIssuePRs(id),
    activity: listActivity(issue.project_id, { issue_id: id }),
  };
}

export function createIssue(projectId: string, input: CreateIssueInput): Issue {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO Issue (id, project_id, title, description, max_review_rounds, priority, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    projectId,
    input.title,
    input.description,
    input.max_review_rounds ?? null,
    input.priority ?? 0,
    input.created_by ?? "user"
  );
  return getIssue(id)!;
}

export function updateIssue(id: string, input: UpdateIssueInput): Issue {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.title !== undefined) { fields.push("title = ?"); values.push(input.title); }
  if (input.description !== undefined) { fields.push("description = ?"); values.push(input.description); }
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.priority !== undefined) { fields.push("priority = ?"); values.push(input.priority); }
  if (input.assigned_agent_id !== undefined) { fields.push("assigned_agent_id = ?"); values.push(input.assigned_agent_id); }
  if (input.max_review_rounds !== undefined) { fields.push("max_review_rounds = ?"); values.push(input.max_review_rounds); }
  if (input.current_review_round !== undefined) { fields.push("current_review_round = ?"); values.push(input.current_review_round); }
  if (input.branch_name !== undefined) { fields.push("branch_name = ?"); values.push(input.branch_name); }
  if (input.worktree_path !== undefined) { fields.push("worktree_path = ?"); values.push(input.worktree_path); }
  if (input.base_branch !== undefined) { fields.push("base_branch = ?"); values.push(input.base_branch); }
  if (input.repo_id !== undefined) { fields.push("repo_id = ?"); values.push(input.repo_id); }

  if (fields.length > 0) {
    fields.push("updated_at = CURRENT_TIMESTAMP");
    db.prepare(`UPDATE Issue SET ${fields.join(", ")} WHERE id = ?`).run(...values, id);
  }

  // Note: getIssue(id)! asserts non-null. If called with a non-existent id the update
  // no-ops and the ! assertion throws. Callers are expected to verify existence first.
  return getIssue(id)!;
}

export function deleteIssue(id: string): void {
  db.transaction(() => {
    db.prepare("DELETE FROM ActivityLog WHERE issue_id = ?").run(id);
    db.prepare("DELETE FROM IssueAgent WHERE issue_id = ?").run(id);
    db.prepare("DELETE FROM IssuePR WHERE issue_id = ?").run(id);
    db.prepare("DELETE FROM Comment WHERE issue_id = ?").run(id);
    db.prepare("DELETE FROM Issue WHERE id = ?").run(id);
  })();
}
