/**
 * SSH-based git credential helper.
 * Writes an SSH private key to a temp file and returns env vars
 * for GIT_SSH_COMMAND so git operations use the correct identity.
 */
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { db } from "../db/index.js";

const sshKeyDir = path.join(tmpdir(), "crewdeck-ssh");

/**
 * Write an SSH private key to a temp file and return env vars
 * that configure git to use it. Call `cleanupSshKey` when done.
 */
export function createGitSshEnv(sshPrivateKey: string): {
  env: Record<string, string>;
  keyPath: string;
} {
  fs.mkdirSync(sshKeyDir, { recursive: true });
  const keyPath = path.join(sshKeyDir, `key-${crypto.randomUUID()}`);
  fs.writeFileSync(keyPath, sshPrivateKey, { mode: 0o600 });
  return {
    env: {
      // accept-new: TOFU for github.com — acceptable since we only connect to known hosts
      GIT_SSH_COMMAND: `ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`,
    },
    keyPath,
  };
}

/** Remove a previously created SSH key file. */
export function cleanupSshKey(keyPath: string): void {
  try {
    fs.unlinkSync(keyPath);
  } catch {}
}

/**
 * Get the gh_token and ssh_private_key for a project's linked GitHub account.
 * Returns undefined if no account is linked.
 */
export function getProjectCredentials(
  projectId: string,
): { ghToken: string; sshPrivateKey: string } | undefined {
  const row = db
    .prepare(
      `SELECT ga.gh_token, ga.ssh_private_key FROM Project p
       JOIN GitHubAccount ga ON ga.id = p.github_account_id
       WHERE p.id = ?`,
    )
    .get(projectId) as
    | { gh_token: string; ssh_private_key: string }
    | undefined;
  if (!row) return undefined;
  return { ghToken: row.gh_token, sshPrivateKey: row.ssh_private_key };
}
