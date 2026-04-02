import { db } from "../index.js";
import type {
  Issue,
  IssueWithRunningAgent,
  IssueWithDetails,
  CreateIssueInput,
  UpdateIssueInput,
  IssueFilters,
  PaginatedIssues,
} from "../../types/entities.js";
import { IssueStatus } from "../../constants/statuses.js";
import { listComments } from "./comments.js";
import { listIssuePRs } from "./issue-prs.js";
import { listActivity } from "./activity-log.js";
import { getRepo } from "./repos.js";
import { buildAndRunUpdate, deserializeBoolean } from "./utils.js";
import {
  listDependenciesBatchWithDetails,
  listDependentsBatchWithDetails,
} from "./issue-dependencies.js";

function fromRowWithRunningAgent(
  row: Record<string, unknown>,
): IssueWithRunningAgent {
  return {
    ...(row as Omit<IssueWithRunningAgent, "paused">),
    paused: deserializeBoolean(row.paused),
  };
}

export function listIssues(
  projectId: string,
  filters: IssueFilters = {},
): IssueWithRunningAgent[] {
  const { conditions, values, sortCol, order } = buildListIssuesQuery(projectId, filters);

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

  const rows = db.prepare(sql).all(...values) as Record<string, unknown>[];
  return rows.map(fromRowWithRunningAgent);
}

export function listIssuesPaginated(
  projectId: string,
  filters: IssueFilters = {},
): PaginatedIssues {
  const limit = Math.min(filters.limit ?? 50, 100);
  const offset = filters.offset ?? 0;
  const { conditions, values, sortCol, order } = buildListIssuesQuery(projectId, filters);
  const whereClause = conditions.join(" AND ");

  const countRow = db
    .prepare(`SELECT COUNT(*) as count FROM Issue i WHERE ${whereClause}`)
    .get(...values) as { count: number };
  const total = countRow.count;

  const sql = `
    SELECT i.*, ar.agent_id AS running_agent_id, ar.status AS running_agent_status
    FROM Issue i
    LEFT JOIN (
      SELECT issue_id, agent_id, status,
        ROW_NUMBER() OVER (PARTITION BY issue_id ORDER BY created_at DESC) AS rn
      FROM AgentRun
      WHERE status IN ('running', 'queued')
    ) ar ON ar.issue_id = i.id AND ar.rn = 1
    WHERE ${whereClause}
    ORDER BY i.${sortCol} ${order}
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(sql).all(...values, limit, offset) as Record<string, unknown>[];
  return {
    issues: rows.map(fromRowWithRunningAgent),
    total,
    limit,
    offset,
  };
}

function buildListIssuesQuery(
  projectId: string,
  filters: IssueFilters,
): { conditions: string[]; values: unknown[]; sortCol: string; order: string } {
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

  return { conditions, values, sortCol, order };
}

function fromRow(row: Record<string, unknown>): Issue {
  return {
    ...(row as Omit<Issue, "paused">),
    paused: deserializeBoolean(row.paused),
  };
}

export function getIssue(id: string): Issue | null {
  const row = db.prepare("SELECT * FROM Issue WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? fromRow(row) : null;
}

/**
 * Find an issue by ID prefix within a project.
 * Used when the Monitor LLM outputs truncated issue IDs.
 * Returns null if zero or multiple matches (ambiguous).
 */
export function getIssueByPrefix(
  prefix: string,
  projectId: string,
): Issue | null {
  const rows = db
    .prepare(
      "SELECT * FROM Issue WHERE id LIKE ? || '%' AND project_id = ? LIMIT 2",
    )
    .all(prefix, projectId) as Record<string, unknown>[];
  return rows.length === 1 ? fromRow(rows[0]) : null;
}

export function getIssueWithDetails(id: string): IssueWithDetails | null {
  const issue = getIssue(id);
  if (!issue) return null;

  const repoRow = issue.repo_id ? getRepo(issue.repo_id) : null;
  const repo = repoRow ? { id: repoRow.id, name: repoRow.name } : null;

  const depsMap = listDependenciesBatchWithDetails([id]);
  const dependentsMap = listDependentsBatchWithDetails([id]);

  return {
    ...issue,
    comments: listComments(id, Infinity),
    issue_prs: listIssuePRs(id),
    activity_log: listActivity(issue.project_id, { issue_id: id }),
    repo,
    dependencies: depsMap.get(id) ?? [],
    dependents: dependentsMap.get(id) ?? [],
  };
}

export function createIssue(projectId: string, input: CreateIssueInput): Issue {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO Issue (id, project_id, title, description, created_by, status, agent_id, base_branch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    projectId,
    input.title,
    input.description,
    input.created_by ?? "user",
    input.status ?? IssueStatus.OPEN,
    input.agent_id ?? null,
    input.base_branch ?? null,
  );
  return getIssue(id)!;
}

export function updateIssue(id: string, input: UpdateIssueInput): Issue {
  const overrides: Record<string, unknown> = {};
  if (input.paused !== undefined) {
    overrides.paused = input.paused ? 1 : 0;
  }
  buildAndRunUpdate("Issue", id, input, overrides);
  return getIssue(id)!;
}

export function deleteIssue(id: string): void {
  db.transaction(() => {
    db.prepare("DELETE FROM AgentRun WHERE issue_id = ?").run(id);
    db.prepare("DELETE FROM ActivityLog WHERE issue_id = ?").run(id);
    db.prepare("DELETE FROM IssuePR WHERE issue_id = ?").run(id);
    db.prepare("DELETE FROM Comment WHERE issue_id = ?").run(id);
    db.prepare("DELETE FROM Issue WHERE id = ?").run(id);
  })();
}

/**
 * Pause an issue — pure DB update.
 */
export function pauseIssue(issueId: string): void {
  db.prepare("UPDATE Issue SET paused = 1 WHERE id = ?").run(issueId);
}

/**
 * Resume an issue — pure DB update.
 */
export function resumeIssue(issueId: string): void {
  db.prepare("UPDATE Issue SET paused = 0 WHERE id = ?").run(issueId);
}

/**
 * Batch-fetch issue titles by IDs. Returns a map of id → title.
 */
export function getTitlesByIds(ids: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => "?").join(", ");
  const rows = db
    .prepare(`SELECT id, title FROM Issue WHERE id IN (${placeholders})`)
    .all(...ids) as { id: string; title: string }[];
  for (const row of rows) {
    map.set(row.id, row.title);
  }
  return map;
}

/**
 * Batch-fetch issues by IDs. Returns a map of id → Issue.
 */
export function getByIds(ids: string[]): Map<string, Issue> {
  const map = new Map<string, Issue>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => "?").join(", ");
  const rows = db
    .prepare(`SELECT * FROM Issue WHERE id IN (${placeholders})`)
    .all(...ids) as Record<string, unknown>[];
  for (const row of rows) {
    const issue = fromRow(row);
    map.set(issue.id, issue);
  }
  return map;
}

/**
 * Returns the IDs of all currently paused issues.
 */
export function listPausedIssueIds(): string[] {
  const rows = db.prepare("SELECT id FROM Issue WHERE paused = 1").all() as {
    id: string;
  }[];
  return rows.map((r) => r.id);
}
