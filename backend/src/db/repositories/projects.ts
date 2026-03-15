import { db } from "../index.js";
import type {
  Project,
  ProjectWithStats,
  CreateProjectInput,
  UpdateProjectInput,
} from "../../types/entities.js";
import { ensureCloned, insertRepo } from "./repos.js";
import { getGitHubAccount } from "./github-accounts.js";
import { getSession } from "./sessions.js";

export function listProjects(): Project[] {
  return db
    .prepare("SELECT * FROM Project ORDER BY created_at DESC")
    .all() as Project[];
}

export function listProjectsWithStats(): ProjectWithStats[] {
  type StatsRow = Project & {
    repo_count: number;
    agent_count: number;
    issue_open: number | null;
    issue_in_progress: number | null;
    issue_in_review: number | null;
    issue_ready: number | null;
    issue_done: number | null;
  };

  const rows = db
    .prepare(
      `SELECT
        p.*,
        COUNT(DISTINCT r.id) AS repo_count,
        COUNT(DISTINCT a.id) AS agent_count,
        SUM(i.status = 'open')        AS issue_open,
        SUM(i.status = 'in_progress') AS issue_in_progress,
        SUM(i.status = 'in_review')   AS issue_in_review,
        SUM(i.status = 'ready')       AS issue_ready,
        SUM(i.status = 'done')        AS issue_done
      FROM Project p
      LEFT JOIN Repo  r ON r.project_id = p.id
      LEFT JOIN Crew  c ON c.project_id = p.id
      LEFT JOIN Agent a ON a.crew_id    = c.id
      LEFT JOIN Issue i ON i.project_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC`,
    )
    .all() as StatsRow[];

  return rows.map((row) => {
    let orchestrator_status: ProjectWithStats["orchestrator_status"] = "none";
    if (row.orchestrator_session_id) {
      const session = getSession(row.orchestrator_session_id);
      if (session) {
        orchestrator_status =
          session.status === "running"
            ? "active"
            : session.status === "error"
              ? "error"
              : "idle";
      }
    }

    return {
      ...row,
      issues: {
        open: row.issue_open ?? 0,
        in_progress: row.issue_in_progress ?? 0,
        in_review: row.issue_in_review ?? 0,
        ready: row.issue_ready ?? 0,
        done: row.issue_done ?? 0,
      },
      orchestrator_status,
    };
  });
}

export function getProject(id: string): Project | null {
  return (
    (db.prepare("SELECT * FROM Project WHERE id = ?").get(id) as Project) ??
    null
  );
}

export function createProject(input: CreateProjectInput): Project {
  const id = crypto.randomUUID();
  const crewId = crypto.randomUUID();

  // Clone repo before opening the transaction to avoid holding the SQLite write lock
  // during a potentially slow git clone operation.
  if (input.github_url) {
    const ghAccount = input.github_account_id
      ? getGitHubAccount(input.github_account_id)
      : null;
    ensureCloned(input.github_url, ghAccount?.oauth_token);
  }

  db.transaction(() => {
    db.prepare(
      `INSERT INTO Project (id, name, description, max_concurrency, max_review_rounds, github_account_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name,
      input.description ?? null,
      input.max_concurrency ?? 1,
      input.max_review_rounds ?? 3,
      input.github_account_id ?? null,
    );

    db.prepare(`INSERT INTO Crew (id, project_id, name) VALUES (?, ?, ?)`).run(
      crewId,
      id,
      input.name,
    );

    if (input.github_url) {
      insertRepo(id, {
        github_url: input.github_url,
        default_branch: input.default_branch,
      });
    }
  })();

  return getProject(id)!;
}

export function updateProject(id: string, input: UpdateProjectInput): Project {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    fields.push("name = ?");
    values.push(input.name);
  }
  if (input.description !== undefined) {
    fields.push("description = ?");
    values.push(input.description);
  }
  if (input.max_concurrency !== undefined) {
    fields.push("max_concurrency = ?");
    values.push(input.max_concurrency);
  }
  if (input.max_review_rounds !== undefined) {
    fields.push("max_review_rounds = ?");
    values.push(input.max_review_rounds);
  }
  if (input.orchestrator_session_id !== undefined) {
    fields.push("orchestrator_session_id = ?");
    values.push(input.orchestrator_session_id);
  }
  if (input.github_account_id !== undefined) {
    fields.push("github_account_id = ?");
    values.push(input.github_account_id);
  }

  if (fields.length > 0) {
    fields.push("updated_at = CURRENT_TIMESTAMP");
    db.prepare(`UPDATE Project SET ${fields.join(", ")} WHERE id = ?`).run(
      ...values,
      id,
    );
  }

  return getProject(id)!;
}

export function deleteProject(id: string): void {
  // Cascade delete all related data in FK-safe order.
  // Edge case: if another project's issue has an IssuePR pointing at one of this
  // project's repos, the `DELETE FROM Repo` below will fail with a FK constraint error
  // because IssuePR.repo_id is NOT NULL. This cross-project scenario is not supported
  // by the current data model — IssuePRs are expected to reference repos in the same
  // project as the issue. Not fixing now; enforce at the route layer when repos are created.
  db.transaction(() => {
    db.prepare("DELETE FROM ActivityLog WHERE project_id = ?").run(id);
    db.prepare(
      "DELETE FROM IssueAgent WHERE issue_id IN (SELECT id FROM Issue WHERE project_id = ?)",
    ).run(id);
    db.prepare(
      "DELETE FROM IssuePR WHERE issue_id IN (SELECT id FROM Issue WHERE project_id = ?)",
    ).run(id);
    db.prepare(
      "DELETE FROM Comment WHERE issue_id IN (SELECT id FROM Issue WHERE project_id = ?)",
    ).run(id);
    db.prepare("DELETE FROM Session WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM Issue WHERE project_id = ?").run(id);
    db.prepare(
      "DELETE FROM Agent WHERE crew_id IN (SELECT id FROM Crew WHERE project_id = ?)",
    ).run(id);
    db.prepare("DELETE FROM Repo WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM Crew WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM Project WHERE id = ?").run(id);
  })();
}
