import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { db } from "../index.js";
import { config } from "../../config.js";
import { toContainerPath } from "../../utils/paths.js";
import { createGitSshEnv, cleanupSshKey } from "../../utils/git-auth.js";
import type { Repo, CreateRepoInput } from "../../types/entities.js";
import { ValidationError } from "../../middleware/errors.js";
import { parseRepoUrl, getProvider } from "../../vcs/registry.js";

/** Parse GitHub URL (deprecated - use parseRepoUrl from vcs/registry) */
export function parseGithubUrl(url: string): { owner: string; name: string } {
  const parsed = parseRepoUrl(url);
  if (parsed.provider !== "github") {
    throw new ValidationError(`Expected GitHub URL, got ${parsed.provider}`);
  }
  return { owner: parsed.owner, name: parsed.name };
}

/** Convert owner/name to SSH URL (deprecated - use VCS provider directly) */
export function toSshUrl(owner: string, name: string): string {
  const client = getProvider("github");
  return client.toSshUrl(owner, name);
}

function cloneIfNeeded(
  githubUrl: string,
  localPath: string,
  sshPrivateKey?: string,
): void {
  const diskPath = toContainerPath(localPath);
  if (fs.existsSync(path.join(diskPath, ".git"))) return;
  fs.mkdirSync(path.dirname(diskPath), { recursive: true });

  const { owner, name } = parseGithubUrl(githubUrl);
  const sshUrl = toSshUrl(owner, name);

  const ssh = sshPrivateKey ? createGitSshEnv(sshPrivateKey) : null;
  try {
    const env = { ...process.env, ...ssh?.env, GIT_TERMINAL_PROMPT: "0" };
    execFileSync("git", ["clone", sshUrl, diskPath], { stdio: "pipe", env });
  } catch (err: unknown) {
    const stderr =
      err instanceof Error && "stderr" in err
        ? String((err as any).stderr).trim()
        : "";
    const safe = (
      stderr || (err instanceof Error ? err.message : "unknown error")
    ).replace(/https?:\/\/[^\s]+/g, "<url>");
    throw new ValidationError(`Failed to clone repository: ${safe}`);
  } finally {
    if (ssh) cleanupSshKey(ssh.keyPath);
  }
}

/** Parse the URL and clone the repo if needed, without touching the DB. */
export function ensureCloned(githubUrl: string, sshPrivateKey?: string): void {
  const { owner, name } = parseGithubUrl(githubUrl);
  const localPath = path.resolve(config.reposDir, owner, name);
  cloneIfNeeded(githubUrl, localPath, sshPrivateKey);
}

/** Insert a repo row. Assumes the repo is already cloned on disk. */
export function insertRepo(projectId: string, input: CreateRepoInput): Repo {
  const id = crypto.randomUUID();
  const { owner, name } = parseGithubUrl(input.github_url);
  const localPath = path.resolve(config.reposDir, owner, name);

  db.prepare(
    `INSERT INTO Repo (id, project_id, github_url, name, owner, local_path, default_branch)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    projectId,
    input.github_url,
    name,
    owner,
    localPath,
    input.default_branch ?? "main",
  );

  return getRepo(id)!;
}

export function listRepos(projectId: string): Repo[] {
  return db
    .prepare("SELECT * FROM Repo WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Repo[];
}

export function getRepo(id: string): Repo | null {
  return (
    (db.prepare("SELECT * FROM Repo WHERE id = ?").get(id) as Repo) ?? null
  );
}

/** Clone the repo (if needed) and insert a DB row. Used by the standalone endpoint. */
export function createRepo(
  projectId: string,
  input: CreateRepoInput,
  sshPrivateKey?: string,
): Repo {
  ensureCloned(input.github_url, sshPrivateKey);
  return insertRepo(projectId, input);
}

export function deleteRepo(id: string): void {
  db.transaction(() => {
    db.prepare("DELETE FROM IssuePR WHERE repo_id = ?").run(id);
    db.prepare("DELETE FROM Repo WHERE id = ?").run(id);
  })();
}
