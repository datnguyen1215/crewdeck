import { db } from "../index.js";
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

  db.prepare(
    `INSERT INTO Repo (id, project_id, github_url, name, owner, local_path, default_branch)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    projectId,
    input.github_url,
    name,
    owner,
    input.local_path,
    input.default_branch ?? "main"
  );

  return getRepo(id)!;
}

export function deleteRepo(id: string): void {
  db.prepare("DELETE FROM Repo WHERE id = ?").run(id);
}
