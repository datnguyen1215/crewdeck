/**
 * Shared git credential helper.
 * Creates a GIT_ASKPASS script that injects an OAuth token so git
 * operations (clone, fetch, push) authenticate without interactive prompts.
 */
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { db } from "../db/index.js";

const askpassDir = path.join(tmpdir(), "crewdeck-askpass");

/**
 * Create a temporary GIT_ASKPASS script for the given token.
 * Returns env vars to merge into a child process environment.
 * Call `cleanupAskpass` with the returned path when done.
 */
export function createGitAuthEnv(token: string): {
  env: Record<string, string>;
  askpassPath: string;
} {
  fs.mkdirSync(askpassDir, { recursive: true });
  const askpassPath = path.join(
    askpassDir,
    `askpass-${crypto.randomUUID()}.sh`,
  );
  fs.writeFileSync(
    askpassPath,
    `#!/bin/sh\nprintf '%s\\n' '${token.replace(/'/g, "'\\''")}'\n`,
    { mode: 0o700 },
  );
  return {
    env: { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: askpassPath },
    askpassPath,
  };
}

/** Remove a previously created askpass script. */
export function cleanupAskpass(askpassPath: string): void {
  try {
    fs.unlinkSync(askpassPath);
  } catch {}
}

/**
 * Get the OAuth token for a project's linked GitHub account.
 * Returns undefined if no account is linked.
 */
export function getProjectToken(projectId: string): string | undefined {
  const row = db
    .prepare(
      `SELECT ga.oauth_token FROM Project p
       JOIN GitHubAccount ga ON ga.id = p.github_account_id
       WHERE p.id = ?`,
    )
    .get(projectId) as { oauth_token: string } | undefined;
  return row?.oauth_token;
}
