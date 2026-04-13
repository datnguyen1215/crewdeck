import { db } from "../index.js";
import type {
  Project,
  ProjectWithStats,
  CreateProjectInput,
  UpdateProjectInput,
} from "../../types/entities.js";
import { ensureCloned, insertRepo } from "./repos.js";
import { getVCSAccount } from "./vcs-accounts.js";
import { buildAndRunUpdate, deserializeBoolean } from "./utils.js";
import { IssueStatus } from "../../constants/statuses.js";
import { createProjectDatabase, dropProjectDatabase } from "../../utils/postgres.js";

function fromRow(row: unknown): Project {
  const r = row as Record<string, unknown>;
  return {
    ...r,
    auto_start: deserializeBoolean(r.auto_start),
    auto_merge: deserializeBoolean(r.auto_merge),
  } as Project;
}

export function listProjects(): Project[] {
  const rows = db
    .prepare("SELECT * FROM Project ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];
  return rows.map(fromRow);
}

export function listProjectsWithStats(): ProjectWithStats[] {
  type StatsRow = Record<string, unknown> & {
    repo_count: number;
    issue_open: number | null;
    issue_in_progress: number | null;
    issue_pr_created: number | null;
    issue_pr_conflict: number | null;
    issue_pr_failed_actions: number | null;
    issue_pr_ready_to_merge: number | null;
    issue_done: number | null;
    active_runs: number;
  };

  const rows = db
    .prepare(
      `SELECT
        p.*,
        COUNT(DISTINCT r.id) AS repo_count,
        SUM(i.status = ?)              AS issue_open,
        SUM(i.status = ?)       AS issue_in_progress,
        SUM(i.status = ?)        AS issue_pr_created,
        SUM(i.status = ?)       AS issue_pr_conflict,
        SUM(i.status = ?) AS issue_pr_failed_actions,
        SUM(i.status = ?) AS issue_pr_ready_to_merge,
        SUM(i.status = ?)              AS issue_done,
        (SELECT COUNT(*) FROM AgentRun ar WHERE ar.project_id = p.id AND ar.status IN ('running', 'queued')) AS active_runs
      FROM Project p
      LEFT JOIN Repo  r ON r.project_id = p.id
      LEFT JOIN Issue i ON i.project_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC`,
    )
    .all(
      IssueStatus.OPEN,
      IssueStatus.IN_PROGRESS,
      IssueStatus.PR_CREATED,
      IssueStatus.PR_CONFLICT,
      IssueStatus.PR_FAILED_ACTIONS,
      IssueStatus.PR_READY_TO_MERGE,
      IssueStatus.DONE,
    ) as StatsRow[];

  return rows.map((row) => ({
    ...fromRow(row),
    repo_count: row.repo_count,
    issues: {
      open: row.issue_open ?? 0,
      in_progress: row.issue_in_progress ?? 0,
      pr_created: row.issue_pr_created ?? 0,
      pr_conflict: row.issue_pr_conflict ?? 0,
      pr_failed_actions: row.issue_pr_failed_actions ?? 0,
      pr_ready_to_merge: row.issue_pr_ready_to_merge ?? 0,
      done: row.issue_done ?? 0,
    },
    active_runs: row.active_runs,
  }));
}

export function getProject(id: string): Project | null {
  const row = db.prepare("SELECT * FROM Project WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? fromRow(row) : null;
}

export function createProject(input: CreateProjectInput): Project {
  const id = crypto.randomUUID();

  if (input.repo_url) {
    const vcsAccount = input.vcs_account_id
      ? getVCSAccount(input.vcs_account_id)
      : null;
    ensureCloned(input.repo_url, vcsAccount?.ssh_private_key);
  }

  db.transaction(() => {
    db.prepare(
      `INSERT INTO Project (id, name, description, vcs_account_id, default_base_branch)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name,
      input.description ?? null,
      input.vcs_account_id ?? null,
      input.default_base_branch ?? "main",
    );

    if (input.repo_url) {
      insertRepo(id, {
        repo_url: input.repo_url,
        default_branch: input.default_branch,
      });
    }
  })();

  return getProject(id)!;
}

export async function updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
  // Convert booleans to integers for SQLite
  const overrides: Record<string, unknown> = {};
  if (input.auto_start !== undefined)
    overrides.auto_start = input.auto_start ? 1 : 0;
  if (input.auto_merge !== undefined)
    overrides.auto_merge = input.auto_merge ? 1 : 0;

  const { create_database, ...rest } = input;
  if (create_database) {
    const existing = getProject(id);
    if (existing && !existing.database_name) {
      const dbName = await createProjectDatabase(id);
      overrides.database_name = dbName;
    }
  }

  buildAndRunUpdate("Project", id, rest, overrides);
  return getProject(id)!;
}

export type CaptainStatus = "idle" | "receiving" | "thinking" | "executing";

export function updateCaptainStatus(
  id: string,
  status: CaptainStatus,
  detail?: string | null,
  pendingCount?: number,
): void {
  if (status === "idle") {
    db.prepare(
      `UPDATE Project SET captain_status = 'idle', captain_status_detail = NULL,
       captain_pending_count = 0, captain_processing_since = NULL WHERE id = ?`,
    ).run(id);
  } else if (status === "receiving") {
    // Only set processing_since if not already processing
    db.prepare(
      `UPDATE Project SET captain_status = 'receiving',
       captain_status_detail = ?,
       captain_pending_count = ?,
       captain_processing_since = COALESCE(captain_processing_since, CURRENT_TIMESTAMP)
       WHERE id = ?`,
    ).run(detail ?? null, pendingCount ?? 0, id);
  } else {
    db.prepare(
      `UPDATE Project SET captain_status = ?,
       captain_status_detail = ?,
       captain_pending_count = ?,
       captain_processing_since = COALESCE(captain_processing_since, CURRENT_TIMESTAMP)
       WHERE id = ?`,
    ).run(status, detail ?? null, pendingCount ?? 0, id);
  }
}

export async function deleteProject(id: string): Promise<void> {
  const project = getProject(id);
  if (project?.database_name) {
    await dropProjectDatabase(project.database_name);
  }
  db.transaction(() => {
    // ProjectKnowledge has ON DELETE CASCADE — no manual delete needed
    // AgentRun has ON DELETE CASCADE on project_id (migration 046) — no manual delete needed
    // AgentRunEvent has ON DELETE CASCADE on agent_run_id — no manual delete needed
    db.prepare("DELETE FROM EnvironmentVariable WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM ActivityLog WHERE project_id = ?").run(id);
    db.prepare(
      "DELETE FROM IssuePR WHERE issue_id IN (SELECT id FROM Issue WHERE project_id = ?)",
    ).run(id);
    db.prepare(
      "DELETE FROM Comment WHERE issue_id IN (SELECT id FROM Issue WHERE project_id = ?)",
    ).run(id);
    db.prepare("DELETE FROM Issue WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM Repo WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM Project WHERE id = ?").run(id);
  })();
}
