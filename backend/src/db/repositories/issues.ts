import { db } from "../index.js";
import type {
  Issue,
  IssueWithDetails,
  CreateIssueInput,
  UpdateIssueInput,
  IssueFilters,
} from "../../types/entities.js";
import { listComments } from "./comments.js";
import { listIssuePRs } from "./issue-prs.js";
import { listActivity } from "./activity-log.js";
import { getRepo } from "./repos.js";
import { buildAndRunUpdate } from "./utils.js";

export function listIssues(projectId: string, filters: IssueFilters = {}): Issue[] {
  const conditions: string[] = ["project_id = ?"];
  const values: unknown[] = [projectId];

  if (filters.status?.length) {
    const placeholders = filters.status.map(() => "?").join(", ");
    conditions.push(`status IN (${placeholders})`);
    values.push(...filters.status);
  }

  if (filters.created_by !== undefined) {
    conditions.push("created_by = ?");
    values.push(filters.created_by);
  }

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

  const repoRow = issue.repo_id ? getRepo(issue.repo_id) : null;
  const repo = repoRow ? { id: repoRow.id, name: repoRow.name } : null;

  return {
    ...issue,
    comments: listComments(id),
    issue_prs: listIssuePRs(id),
    activity_log: listActivity(issue.project_id, { issue_id: id }),
    repo,
  };
}

export function createIssue(projectId: string, input: CreateIssueInput): Issue {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO Issue (id, project_id, title, description, priority, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    projectId,
    input.title,
    input.description,
    input.priority ?? 0,
    input.created_by ?? "user",
    input.status ?? "open",
  );
  return getIssue(id)!;
}

export function updateIssue(id: string, input: UpdateIssueInput): Issue {
  buildAndRunUpdate("Issue", id, input);
  return getIssue(id)!;
}

export function deleteIssue(id: string): void {
  db.transaction(() => {
    db.prepare("DELETE FROM ActivityLog WHERE issue_id = ?").run(id);
    db.prepare("DELETE FROM IssuePR WHERE issue_id = ?").run(id);
    db.prepare("DELETE FROM Comment WHERE issue_id = ?").run(id);
    db.prepare("DELETE FROM Issue WHERE id = ?").run(id);
  })();
}
