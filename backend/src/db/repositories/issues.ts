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
import { buildAndRunUpdate } from "./utils.js";
import { getAgent } from "./agents.js";
import { getRepo } from "./repos.js";

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

  // Fetch issue agents with embedded agent info
  const issueAgents = listIssueAgents(id).map((ia) => {
    const agent = getAgent(ia.agent_id);
    return {
      ...ia,
      agent: agent ? { id: agent.id, name: agent.name } : null,
    };
  });

  // Reuse agent from issueAgents if available, otherwise fetch
  const assignedAgent = issue.assigned_agent_id
    ? issueAgents.find((ia) => ia.agent_id === issue.assigned_agent_id)?.agent ??
      (() => {
        const a = getAgent(issue.assigned_agent_id);
        return a ? { id: a.id, name: a.name } : null;
      })()
    : null;

  // Fetch repo info
  const repoRow = issue.repo_id ? getRepo(issue.repo_id) : null;
  const repo = repoRow ? { id: repoRow.id, name: repoRow.name } : null;

  const issuePRs = listIssuePRs(id);

  // TODO: remove legacy agents/prs fields once all consumers use issue_agents/issue_prs
  return {
    ...issue,
    comments: listComments(id),
    agents: issueAgents,
    prs: issuePRs,
    activity: listActivity(issue.project_id, { issue_id: id }),
    issue_agents: issueAgents,
    issue_prs: issuePRs,
    assigned_agent: assignedAgent,
    repo,
  };
}

export function createIssue(projectId: string, input: CreateIssueInput): Issue {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO Issue (id, project_id, title, description, max_review_rounds, priority, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    projectId,
    input.title,
    input.description,
    input.max_review_rounds ?? null,
    input.priority ?? 0,
    input.created_by ?? "user",
    input.status ?? "open"
  );
  return getIssue(id)!;
}

export function updateIssue(id: string, input: UpdateIssueInput): Issue {
  buildAndRunUpdate("Issue", id, input);
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
