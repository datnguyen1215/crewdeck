/** VCS account repository for managing SSH key + PAT linked accounts. */
import { db } from "../index.js";
import type {
  VCSAccount,
  CreateVCSAccountInput,
} from "../../types/entities.js";

/** @returns All VCS accounts ordered by most recently created. */
export const listVCSAccounts = (): VCSAccount[] =>
  db
    .prepare("SELECT * FROM VCSAccount ORDER BY created_at DESC")
    .all() as VCSAccount[];

/** @returns The VCS account with the given id, or null if not found. */
export const getVCSAccount = (id: string): VCSAccount | null =>
  (db
    .prepare("SELECT * FROM VCSAccount WHERE id = ?")
    .get(id) as VCSAccount) ?? null;

/** Creates a new VCS account record. */
export const createVCSAccount = (
  input: CreateVCSAccountInput,
): VCSAccount => {
  const id = crypto.randomUUID();
  const provider = input.provider ?? "github";
  db.prepare(
    `INSERT INTO VCSAccount (id, provider, account_name, username, token, ssh_private_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    provider,
    input.account_name,
    input.username,
    input.token,
    input.ssh_private_key,
  );
  return getVCSAccount(id)!;
};

/** Updates an existing VCS account. */
export const updateVCSAccount = (
  id: string,
  input: Partial<
    Pick<
      VCSAccount,
      "account_name" | "username" | "token" | "ssh_private_key"
    >
  >,
): VCSAccount | null => {
  const ALLOWED_COLS = new Set([
    "account_name",
    "username",
    "token",
    "ssh_private_key",
  ]);
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && ALLOWED_COLS.has(key)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.length === 0) return getVCSAccount(id);
  values.push(id);
  db.prepare(`UPDATE VCSAccount SET ${fields.join(", ")} WHERE id = ?`).run(
    ...values,
  );
  return getVCSAccount(id);
};

/** @returns The first VCS account matching the given username, or null. */
export const getVCSAccountByUsername = (
  username: string,
): VCSAccount | null =>
  (db
    .prepare("SELECT * FROM VCSAccount WHERE username = ? LIMIT 1")
    .get(username) as VCSAccount) ?? null;

/** Deletes a VCS account. Project.vcs_account_id is nullified by ON DELETE SET NULL. */
export const deleteVCSAccount = (id: string): void => {
  db.prepare("DELETE FROM VCSAccount WHERE id = ?").run(id);
};
