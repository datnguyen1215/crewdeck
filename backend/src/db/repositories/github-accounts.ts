/** GitHub account repository for managing OAuth-linked GitHub accounts. */
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
    `INSERT INTO GitHubAccount (id, account_name, github_username, oauth_token, scopes)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.account_name, input.github_username, input.oauth_token, input.scopes ?? null);
  return getGitHubAccount(id)!;
};

/** @returns The first GitHub account matching the given username, or null. */
export const getGitHubAccountByUsername = (username: string): GitHubAccount | null =>
  (db
    .prepare("SELECT * FROM GitHubAccount WHERE github_username = ? LIMIT 1")
    .get(username) as GitHubAccount) ?? null;

/** Deletes a GitHub account. Project.github_account_id is nullified by ON DELETE SET NULL. */
export const deleteGitHubAccount = (id: string): void => {
  db.prepare("DELETE FROM GitHubAccount WHERE id = ?").run(id);
};
