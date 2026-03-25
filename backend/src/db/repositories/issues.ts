import { db } from "../index.js";
import type {
  Issue,
  IssueWithRunningAgent,
  IssueWithDetails,
  CreateIssueInput,
  UpdateIssueInput,
  IssueFilters,
} from "../../types/entities.js";
import { IssueStatus } from "../../constants/statuses.js";
import { listComments } from "./comments.js";
import { listIssuePRs } from "./issue-prs.js";
import { listActivity } from "./activity-log.js";
import { getRepo } from "./repos.js";
import { buildAndRunUpdate } from "./utils.js";

export function listIssues(
  projectId: string,
  filters: IssueFilters = {},
): IssueWithRunningAgent[] {
  const conditions: string[] = ["i.project_id = ?"];
  const values: unknown[] = [projectId];

  if (filters.status?.length) {
    const placeholders = filters.status.map(() => "?").join(", ");
    conditions.push(`i.status IN (${placeholders})`);
    values.push(...filters.status);
  }

  if (filters.created_by !== undefined) {
    conditions.push("i.created_by = ?");
    values.push(filters.created_by);
  }

  const SORT_COLS = ["created_at", "updated_at"] as const;
  const ORDERS = ["asc", "desc"] as const;
  const sortCol = SORT_COLS.includes(filters.sort as (typeof SORT_COLS)[number])
    ? filters.sort!
    : "created_at";
  const order = ORDERS.includes(filters.order as (typeof ORDERS)[number])
    ? filters.order!
    : "desc";

  // LEFT JOIN to get the most recent running/queued agent per issue
  // Uses a subquery to pick the single most recent active run per issue
  const sql = `
    SELECT i.*, ar.agent_id AS running_agent_id, ar.status AS running_agent_status
    FROM Issue i
    LEFT JOIN (
      SELECT issue_id, agent_id, status,
        ROW_NUMBER() OVER (PARTITION BY issue_id ORDER BY created_at DESC) AS rn
      FROM AgentRun
      WHERE status IN ('running', 'queued')
    ) ar ON ar.issue_id = i.id AND ar.rn = 1
    WHERE ${conditions.join(" AND ")}
    ORDER BY i.${sortCol} ${order}
  `;

  return db.prepare(sql).all(...values) as IssueWithRunningAgent[];
}

export function getIssue(id: string): Issue | null {
  return (
    (db.prepare("SELECT * FROM Issue WHERE id = ?").get(id) as Issue) ?? null
  );
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
    `INSERT INTO Issue (id, project_id, title, description, created_by, status, agent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    projectId,
    input.title,
    input.description,
    input.created_by ?? "user",
    input.status ?? IssueStatus.OPEN,
    input.agent_id ?? null,
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
