import { db } from "../index.js";
import type {
  IssuePR,
  CreateIssuePRInput,
  UpdateIssuePRInput,
} from "../../types/entities.js";
import { buildAndRunUpdate } from "./utils.js";
import { PRStatus } from "../../constants/statuses.js";

export function listIssuePRs(issueId: string): IssuePR[] {
  return db
    .prepare("SELECT * FROM IssuePR WHERE issue_id = ? ORDER BY created_at ASC")
    .all(issueId) as IssuePR[];
}

export function getIssuePR(id: string): IssuePR | null {
  return (
    (db.prepare("SELECT * FROM IssuePR WHERE id = ?").get(id) as IssuePR) ??
    null
  );
}

export function createIssuePR(input: CreateIssuePRInput): IssuePR {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO IssuePR (id, issue_id, repo_id, pr_number, pr_url, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.issue_id,
    input.repo_id,
    input.pr_number,
    input.pr_url,
    input.status ?? PRStatus.OPEN,
  );
  return getIssuePR(id)!;
}

export function updateIssuePR(id: string, input: UpdateIssuePRInput): IssuePR {
  buildAndRunUpdate("IssuePR", id, input);
  return getIssuePR(id)!;
}

/** Check if an IssuePR record exists for the given repo + PR number. */
export function getIssuePRByRepoAndNumber(
  repoId: string,
  prNumber: number,
): IssuePR | null {
  return (
    (db
      .prepare("SELECT * FROM IssuePR WHERE repo_id = ? AND pr_number = ?")
      .get(repoId, prNumber) as IssuePR) ?? null
  );
}

/** List all PRs with status "open" for polling. Includes repo and project info. */
export interface OpenPRWithContext {
  id: string;
  issue_id: string;
  repo_id: string;
  pr_number: number;
  pr_url: string;
  status: string;
  repo_owner: string;
  repo_name: string;
  project_id: string;
  github_account_id: string | null;
}

export function listOpenPRsWithContext(): OpenPRWithContext[] {
  return db
    .prepare(
      `
    SELECT
      pr.id, pr.issue_id, pr.repo_id, pr.pr_number, pr.pr_url, pr.status,
      r.owner AS repo_owner, r.name AS repo_name,
      p.id AS project_id, p.github_account_id
    FROM IssuePR pr
    JOIN Repo r ON r.id = pr.repo_id
    JOIN Issue i ON i.id = pr.issue_id
    JOIN Project p ON p.id = i.project_id
    WHERE pr.status = 'open'
  `,
    )
    .all() as OpenPRWithContext[];
}
