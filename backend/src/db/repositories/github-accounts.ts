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

/** Deletes a GitHub account. Project.github_account_id is nullified by ON DELETE SET NULL. */
export const deleteGitHubAccount = (id: string): void => {
  db.prepare("DELETE FROM GitHubAccount WHERE id = ?").run(id);
};

/** Updates the OAuth token, scopes, and username after re-authentication. */
export const updateGitHubAccountToken = (
  id: string,
  token: string,
  scopes: string,
  username: string,
): GitHubAccount => {
  db.prepare(
    `UPDATE GitHubAccount SET oauth_token = ?, scopes = ?, github_username = ? WHERE id = ?`,
  ).run(token, scopes, username, id);
  return getGitHubAccount(id)!;
};
