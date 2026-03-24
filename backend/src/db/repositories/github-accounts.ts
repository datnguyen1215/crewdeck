/** GitHub account repository for managing SSH key + PAT linked accounts. */
import { db } from "../index.js";
import type {
  GitHubAccount,
  CreateGitHubAccountInput,
} from "../../types/entities.js";

/** @returns All GitHub accounts ordered by most recently created. */
export const listGitHubAccounts = (): GitHubAccount[] =>
  db
    .prepare("SELECT * FROM GitHubAccount ORDER BY created_at DESC")
    .all() as GitHubAccount[];

/** @returns The GitHub account with the given id, or null if not found. */
export const getGitHubAccount = (id: string): GitHubAccount | null =>
  (db
    .prepare("SELECT * FROM GitHubAccount WHERE id = ?")
    .get(id) as GitHubAccount) ?? null;

/** Creates a new GitHub account record. */
export const createGitHubAccount = (
  input: CreateGitHubAccountInput,
): GitHubAccount => {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO GitHubAccount (id, account_name, github_username, gh_token, ssh_private_key)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.account_name,
    input.github_username,
    input.gh_token,
    input.ssh_private_key,
  );
  return getGitHubAccount(id)!;
};

/** Updates an existing GitHub account. */
export const updateGitHubAccount = (
  id: string,
  input: Partial<
    Pick<
      GitHubAccount,
      "account_name" | "github_username" | "gh_token" | "ssh_private_key"
    >
  >,
): GitHubAccount | null => {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.length === 0) return getGitHubAccount(id);
  values.push(id);
  db.prepare(`UPDATE GitHubAccount SET ${fields.join(", ")} WHERE id = ?`).run(
    ...values,
  );
  return getGitHubAccount(id);
};

/** @returns The first GitHub account matching the given username, or null. */
export const getGitHubAccountByUsername = (
  username: string,
): GitHubAccount | null =>
  (db
    .prepare("SELECT * FROM GitHubAccount WHERE github_username = ? LIMIT 1")
    .get(username) as GitHubAccount) ?? null;

/** Deletes a GitHub account. Project.github_account_id is nullified by ON DELETE SET NULL. */
export const deleteGitHubAccount = (id: string): void => {
  db.prepare("DELETE FROM GitHubAccount WHERE id = ?").run(id);
};
