import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Issue, Repo } from "../types/entities.js";

const execFileAsync = promisify(execFile);

export interface PRResult {
  url: string;
  number: number;
}

/**
 * Extract PR number from a GitHub PR URL.
 * Examples:
 *   https://github.com/owner/repo/pull/123 → 123
 */
function parsePrNumber(url: string): number {
  const match = url.match(/\/pull\/(\d+)$/);
  if (!match) {
    throw new Error(`Could not parse PR number from URL: ${url}`);
  }
  return parseInt(match[1], 10);
}

/**
 * Create a GitHub PR using the gh CLI.
 *
 * The gh pr create command outputs the PR URL to stdout on success.
 * We parse the URL to extract the PR number.
 */
export async function createPR(
  issue: Issue,
  repo: Repo,
  opts?: { token?: string }
): Promise<PRResult> {
  if (!issue.branch_name) {
    throw new Error("Issue has no branch_name set");
  }

  const baseBranch = issue.base_branch ?? repo.default_branch;
  const title = issue.title;
  const body = issue.description ?? "";

  const args = [
    "pr",
    "create",
    "--title", title,
    "--body", body,
    "--base", baseBranch,
    "--head", issue.branch_name,
  ];

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (opts?.token) {
    env.GH_TOKEN = opts.token;
  }

  const { stdout } = await execFileAsync("gh", args, {
    cwd: issue.worktree_path ?? repo.local_path,
    env,
    timeout: 60_000,
  });

  // gh pr create outputs the PR URL on a single line
  const url = stdout.trim();
  if (!url.startsWith("https://")) {
    throw new Error(`Unexpected gh pr create output: ${stdout}`);
  }

  const number = parsePrNumber(url);

  return { url, number };
}
