import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { db } from "../index.js";
import { config } from "../../config.js";
import type { Repo, CreateRepoInput } from "../../types/entities.js";

function parseGithubUrl(url: string): { owner: string; name: string } {
  // https://github.com/owner/repo or https://github.com/owner/repo.git
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) return { owner: httpsMatch[1], name: httpsMatch[2] };
  // git@github.com:owner/repo.git
  const sshMatch = url.match(/github\.com:([^/]+)\/([^/.]+)/);
  if (sshMatch) return { owner: sshMatch[1], name: sshMatch[2] };
  throw new Error(`Cannot parse GitHub URL: ${url}`);
}

function cloneIfNeeded(githubUrl: string, localPath: string): void {
  if (fs.existsSync(path.join(localPath, ".git"))) return;
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  execSync(`git clone ${githubUrl} ${localPath}`, { stdio: "pipe" });
}

export function listRepos(projectId: string): Repo[] {
  return db
    .prepare("SELECT * FROM Repo WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Repo[];
}

export function getRepo(id: string): Repo | null {
  return (db.prepare("SELECT * FROM Repo WHERE id = ?").get(id) as Repo) ?? null;
}

export function createRepo(projectId: string, input: CreateRepoInput): Repo {
  const id = crypto.randomUUID();
  const { owner, name } = parseGithubUrl(input.github_url);
  const localPath = path.resolve(config.reposDir, owner, name);

  cloneIfNeeded(input.github_url, localPath);

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

export function deleteRepo(id: string): void {
  // IssuePR.repo_id has a NOT NULL FK to Repo — with foreign_keys=ON this delete
  // would fail if IssuePR rows exist, so we clean them up first.
  db.transaction(() => {
    db.prepare("DELETE FROM IssuePR WHERE repo_id = ?").run(id);
    db.prepare("DELETE FROM Repo WHERE id = ?").run(id);
  })();
}
