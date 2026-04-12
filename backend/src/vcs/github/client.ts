/**
 * GitHub VCS Provider Client
 *
 * Implements the VCSProviderClient interface for GitHub.
 * Consolidates all GitHub API operations, URL parsing, and PR detection.
 */
import { logger } from "../../logger.js";
import { ValidationError } from "../../middleware/errors.js";
import type {
  VCSProviderClient,
  VCSRepoMetadata,
  VCSPRMetadata,
  VCSPRStatus,
  VCSCIStatus,
  ParsedPRUrl,
  CreatePROpts,
  MergePROpts,
  DeleteBranchOpts,
  FetchPRStatusOpts,
  FetchCIStatusOpts,
  FetchRepoMetadataOpts,
} from "../types.js";

const GITHUB_HEADERS = {
  Accept: "application/vnd.github.v3+json",
  "User-Agent": "crewdeck",
};

// Regex to match GitHub PR URLs: https://github.com/owner/repo/pull/123
const PR_URL_REGEX = /https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/g;

// GitHub API response types
interface GitHubRepoResponse {
  name: string;
  description: string | null;
  default_branch: string;
}

interface GitHubPRResponse {
  state: "open" | "closed";
  merged: boolean;
  mergeable: boolean | null;
  head: { sha: string };
}

interface GitHubCheckRun {
  status: "queued" | "in_progress" | "completed";
  conclusion:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "skipped"
    | "timed_out"
    | "action_required"
    | null;
}

interface GitHubCheckRunsResponse {
  total_count: number;
  check_runs: GitHubCheckRun[];
}

interface GitHubStatusResponse {
  state: "success" | "failure" | "pending";
  total_count: number;
}

interface GitHubCreatePRResponse {
  number: number;
  html_url: string;
}

type CheckResult = "pass" | "fail" | "pending";

/**
 * Validate URL segments for security.
 */
function validateSegments(url: string, owner: string, name: string) {
  if (
    !/^[\w.-]+$/.test(owner) ||
    !/^[\w.-]+$/.test(name) ||
    owner === ".." ||
    name === ".."
  )
    throw new ValidationError(`Cannot parse GitHub URL: ${url}`);
  return { owner, name };
}

/**
 * Generic GitHub API fetch with error handling.
 */
async function githubFetch<T>(
  url: string,
  token: string,
  context: string,
): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` },
    });

    if (response.status === 401 || response.status === 403) {
      logger.warn(
        { url, status: response.status },
        `${context}: token invalid or expired`,
      );
      return null;
    }

    if (response.status === 404) {
      logger.warn({ url }, `${context}: not found`);
      return null;
    }

    if (!response.ok) {
      logger.warn(
        { url, status: response.status },
        `${context}: API request failed`,
      );
      return null;
    }

    return (await response.json()) as T;
  } catch (err) {
    logger.error({ err, url }, `${context}: fetch failed`);
    return null;
  }
}

/**
 * Analyze check runs to determine overall CI status.
 */
function analyzeCheckRuns(checkRuns: GitHubCheckRunsResponse): CheckResult {
  if (checkRuns.total_count === 0) return "pass"; // No checks configured

  const runs = checkRuns.check_runs;
  const hasIncomplete = runs.some((r) => r.status !== "completed");
  if (hasIncomplete) return "pending";

  const hasFailed = runs.some(
    (r) =>
      r.conclusion === "failure" ||
      r.conclusion === "cancelled" ||
      r.conclusion === "timed_out",
  );
  return hasFailed ? "fail" : "pass";
}

/**
 * Analyze legacy commit status to determine overall CI status.
 */
function analyzeCommitStatus(status: GitHubStatusResponse): CheckResult {
  if (status.state === "success") return "pass";
  if (status.state === "failure") return "fail";
  // No legacy statuses configured — nothing is blocking
  if (status.state === "pending" && status.total_count === 0) return "pass";
  return "pending";
}

/**
 * Combine check runs and legacy status results.
 */
function combineCheckResults(
  checkRuns: CheckResult,
  legacy: CheckResult,
): CheckResult {
  if (checkRuns === "fail" || legacy === "fail") return "fail";
  if (checkRuns === "pending" || legacy === "pending") return "pending";
  return "pass";
}

/**
 * Fetch the GitHub noreply email for a user via their token.
 * Returns `<id>+<login>@users.noreply.github.com` or null on failure.
 */
export async function fetchNoreplyEmail(
  token: string,
): Promise<string | null> {
  interface GitHubUserResponse {
    id: number;
    login: string;
  }
  const data = await githubFetch<GitHubUserResponse>(
    "https://api.github.com/user",
    token,
    "fetch noreply email",
  );
  if (!data) return null;
  return `${data.id}+${data.login}@users.noreply.github.com`;
}

/**
 * GitHub VCS Provider Client Implementation
 */
export class GitHubClient implements VCSProviderClient {
  /**
   * Parse GitHub URL to extract owner and repo name.
   */
  parseRepoUrl(url: string): { owner: string; name: string } {
    // https://github.com/owner/repo or https://github.com/owner/repo.git
    const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
    if (httpsMatch) return validateSegments(url, httpsMatch[1], httpsMatch[2]);

    // git@github.com:owner/repo.git
    const sshMatch = url.match(/github\.com:([^/]+)\/([^/.]+)/);
    if (sshMatch) return validateSegments(url, sshMatch[1], sshMatch[2]);

    throw new ValidationError(`Cannot parse GitHub URL: ${url}`);
  }

  /**
   * Convert owner/name to SSH URL format.
   */
  toSshUrl(owner: string, name: string): string {
    return `git@github.com:${owner}/${name}.git`;
  }

  /**
   * Fetch repository metadata from GitHub API.
   */
  async fetchRepoMetadata(
    opts: FetchRepoMetadataOpts,
  ): Promise<VCSRepoMetadata> {
    const { owner, name, token } = opts;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const res = await fetch(url, { headers });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `GitHub API error ${res.status} for ${owner}/${name}: ${body}`,
      );
    }

    const data = (await res.json()) as GitHubRepoResponse;
    return {
      name: data.name,
      description: data.description,
      default_branch: data.default_branch,
    };
  }

  /**
   * Create a pull request on GitHub.
   */
  async createPR(opts: CreatePROpts): Promise<VCSPRMetadata> {
    const { owner, repo, head, base, title, body, token } = opts;
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...GITHUB_HEADERS,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, body, head, base }),
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => ({}));
      const message =
        (responseBody as { message?: string }).message ||
        `HTTP ${response.status}`;
      throw new Error(`Failed to create PR: ${message}`);
    }

    const data = (await response.json()) as GitHubCreatePRResponse;
    return {
      number: data.number,
      url: data.html_url,
    };
  }

  /**
   * Merge a pull request on GitHub.
   */
  async mergePR(
    opts: MergePROpts,
  ): Promise<{ success: boolean; message: string }> {
    const { owner, repo, prNumber, token } = opts;
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/merge`;

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: {
          ...GITHUB_HEADERS,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ merge_method: "merge" }),
      });

      if (response.ok)
        return { success: true, message: "PR merged successfully" };

      const body = await response.json().catch(() => ({}));
      const message =
        (body as { message?: string }).message || `HTTP ${response.status}`;

      if (response.status === 405)
        return { success: false, message: `PR not mergeable: ${message}` };
      if (response.status === 409)
        return { success: false, message: `Merge conflict: ${message}` };

      return { success: false, message: `Merge failed: ${message}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { success: false, message: `Merge request failed: ${message}` };
    }
  }

  /**
   * Delete a branch on GitHub.
   */
  async deleteBranch(opts: DeleteBranchOpts): Promise<void> {
    const { owner, repo, branch, token } = opts;
    const url = `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`;

    try {
      const response = await fetch(url, {
        method: "DELETE",
        headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` },
      });

      if (response.ok || response.status === 422) {
        logger.info({ owner, repo, branch }, "Deleted branch after merge");
      } else {
        logger.warn(
          { owner, repo, branch, status: response.status },
          "Failed to delete branch after merge",
        );
      }
    } catch (err) {
      logger.warn({ err, owner, repo, branch }, "Branch deletion failed");
    }
  }

  /**
   * Fetch PR status from GitHub API.
   */
  async fetchPRStatus(opts: FetchPRStatusOpts): Promise<VCSPRStatus | null> {
    const { owner, repo, prNumber, token } = opts;
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
    const data = await githubFetch<GitHubPRResponse>(url, token, "PR status");

    if (!data) return null;

    return {
      state: data.merged ? "merged" : data.state,
      mergeable: data.mergeable,
      head_sha: data.head.sha,
    };
  }

  /**
   * Fetch CI status (combining check runs and legacy status).
   */
  async fetchCIStatus(opts: FetchCIStatusOpts): Promise<VCSCIStatus> {
    const { owner, repo, ref, token } = opts;

    // Fetch both modern check runs and legacy commit status
    const checkRunsUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${ref}/check-runs`;
    const commitStatusUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${ref}/status`;

    const [checkRuns, commitStatus] = await Promise.all([
      githubFetch<GitHubCheckRunsResponse>(checkRunsUrl, token, "Check runs"),
      githubFetch<GitHubStatusResponse>(commitStatusUrl, token, "Commit status"),
    ]);

    const checkRunsResult = checkRuns ? analyzeCheckRuns(checkRuns) : "pending";
    const legacyResult = commitStatus
      ? analyzeCommitStatus(commitStatus)
      : "pending";
    const result = combineCheckResults(checkRunsResult, legacyResult);

    return { result };
  }

  /**
   * Extract all GitHub PR URLs from text content.
   */
  parsePRUrls(content: string): ParsedPRUrl[] {
    const results: ParsedPRUrl[] = [];
    let match;

    // Reset regex state for each call
    PR_URL_REGEX.lastIndex = 0;

    while ((match = PR_URL_REGEX.exec(content)) !== null) {
      results.push({
        owner: match[1],
        name: match[2],
        prNumber: parseInt(match[3], 10),
        url: match[0],
      });
    }

    return results;
  }
}
