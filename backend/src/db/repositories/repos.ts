import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { db } from "../index.js";
import { config } from "../../config.js";
import { toContainerPath } from "../../utils/paths.js";
import type { Repo, CreateRepoInput } from "../../types/entities.js";
import { ValidationError } from "../../middleware/errors.js";

function validateSegments(url: string, owner: string, name: string) {
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name) || owner === '..' || name === '..')
    throw new ValidationError(`Cannot parse GitHub URL: ${url}`);
  return { owner, name };
}

function parseGithubUrl(url: string): { owner: string; name: string } {
  // https://github.com/owner/repo or https://github.com/owner/repo.git
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) return validateSegments(url, httpsMatch[1], httpsMatch[2]);
  // git@github.com:owner/repo.git
  const sshMatch = url.match(/github\.com:([^/]+)\/([^/.]+)/);
  if (sshMatch) return validateSegments(url, sshMatch[1], sshMatch[2]);
  throw new ValidationError(`Cannot parse GitHub URL: ${url}`);
}

function cloneIfNeeded(githubUrl: string, localPath: string): void {
  const diskPath = toContainerPath(localPath);
  if (fs.existsSync(path.join(diskPath, ".git"))) return;
  fs.mkdirSync(path.dirname(diskPath), { recursive: true });
  try {
    execFileSync("git", ["clone", githubUrl, diskPath], { stdio: "pipe" });
  } catch (err: unknown) {
    const stderr =
      err instanceof Error && "stderr" in err
        ? String((err as any).stderr).trim()
        : "";
    // Strip URLs that may contain embedded credentials (e.g. https://token@github.com/...)
    const safe = (stderr || (err instanceof Error ? err.message : "unknown error"))
      .replace(/https?:\/\/[^\s]+/g, "<url>");
    throw new ValidationError(`Failed to clone repository: ${safe}`);
  }
}

/** Parse the URL and clone the repo if needed, without touching the DB. */
export function ensureCloned(githubUrl: string): void {
  const { owner, name } = parseGithubUrl(githubUrl);
  const localPath = path.resolve(config.reposDir, owner, name);
  cloneIfNeeded(githubUrl, localPath);
}

/** Insert a repo row. Assumes the repo is already cloned on disk. */
export function insertRepo(projectId: string, input: CreateRepoInput): Repo {
  const id = crypto.randomUUID();
  const { owner, name } = parseGithubUrl(input.github_url);
  const localPath = path.resolve(config.reposDir, owner, name);

  db.prepare(
    `INSERT INTO Repo (id, project_id, github_url, name, owner, local_path, default_branch)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    projectId,
    input.github_url,
    name,
    owner,
    localPath,
    input.default_branch ?? "main"
  );

  return getRepo(id)!;
}

export function listRepos(projectId: string): Repo[] {
  return db
    .prepare("SELECT * FROM Repo WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Repo[];
}

export function getRepo(id: string): Repo | null {
  return (db.prepare("SELECT * FROM Repo WHERE id = ?").get(id) as Repo) ?? null;
}

/** Clone the repo (if needed) and insert a DB row. Used by the standalone endpoint. */
export function createRepo(projectId: string, input: CreateRepoInput): Repo {
  ensureCloned(input.github_url);
  return insertRepo(projectId, input);
}

export function deleteRepo(id: string): void {
  // IssuePR.repo_id has a NOT NULL FK to Repo — with foreign_keys=ON this delete
  // would fail if IssuePR rows exist, so we clean them up first.
  db.transaction(() => {
    db.prepare("DELETE FROM IssuePR WHERE repo_id = ?").run(id);
    db.prepare("DELETE FROM Repo WHERE id = ?").run(id);
  })();
}
