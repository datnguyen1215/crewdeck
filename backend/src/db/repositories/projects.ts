import { db } from "../index.js";
import type {
  Project,
  ProjectWithStats,
  CreateProjectInput,
  UpdateProjectInput,
} from "../../types/entities.js";
import { ensureCloned, insertRepo } from "./repos.js";
import { getGitHubAccount } from "./github-accounts.js";
import { buildAndRunUpdate } from "./utils.js";

export function listProjects(): Project[] {
  return db
    .prepare("SELECT * FROM Project ORDER BY created_at DESC")
    .all() as Project[];
}

export function listProjectsWithStats(): ProjectWithStats[] {
  type StatsRow = Project & {
    repo_count: number;
    issue_open: number | null;
    issue_in_progress: number | null;
    issue_pr_created: number | null;
    issue_done: number | null;
  };

  const rows = db
    .prepare(
      `SELECT
        p.*,
        COUNT(DISTINCT r.id) AS repo_count,
        SUM(i.status = 'open')        AS issue_open,
        SUM(i.status = 'in_progress') AS issue_in_progress,
        SUM(i.status = 'pr_created')  AS issue_pr_created,
        SUM(i.status = 'done')        AS issue_done
      FROM Project p
      LEFT JOIN Repo  r ON r.project_id = p.id
      LEFT JOIN Issue i ON i.project_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC`,
    )
    .all() as StatsRow[];

  return rows.map((row) => ({
    ...row,
    issues: {
      open: row.issue_open ?? 0,
      in_progress: row.issue_in_progress ?? 0,
      pr_created: row.issue_pr_created ?? 0,
      done: row.issue_done ?? 0,
    },
  }));
}

export function getProject(id: string): Project | null {
  return (
    (db.prepare("SELECT * FROM Project WHERE id = ?").get(id) as Project) ??
    null
  );
}

export function createProject(input: CreateProjectInput): Project {
  const id = crypto.randomUUID();

  if (input.github_url) {
    const ghAccount = input.github_account_id
      ? getGitHubAccount(input.github_account_id)
      : null;
    ensureCloned(input.github_url, ghAccount?.oauth_token);
  }

  db.transaction(() => {
    db.prepare(
      `INSERT INTO Project (id, name, description, max_concurrency, github_account_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name,
      input.description ?? null,
      input.max_concurrency ?? 1,
      input.github_account_id ?? null,
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
  buildAndRunUpdate("Project", id, input);
  return getProject(id)!;
}

export function deleteProject(id: string): void {
  db.transaction(() => {
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
