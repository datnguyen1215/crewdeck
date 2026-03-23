/**
 * Admiral Tool Handlers
 *
 * Server-side business logic for Admiral-specific actions (merge PR,
 * dispatch captain, scan codebase). Exposed via internal API routes.
 */
import { db } from "../../db/index.js";
import { eventBus } from "../../events/bus.js";
import { logger } from "../../logger.js";
import * as issueRepo from "../../db/repositories/issues.js";
import * as issuePRRepo from "../../db/repositories/issue-prs.js";
import { getGitHubAccount } from "../../db/repositories/github-accounts.js";
import { getProject } from "../../db/repositories/projects.js";
import { getCrewMember } from "../crew.js";
import { spawnAgent, spawnScan, postSystemComment } from "../spawner.js";

const GITHUB_HEADERS = {
  Accept: "application/vnd.github.v3+json",
  "User-Agent": "crewdeck",
};

interface ToolResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * Get repo info for an issue PR.
 */
const getRepoInfo = (repoId: string): { owner: string; name: string } | null => {
  const row = db
    .prepare("SELECT owner, name FROM Repo WHERE id = ?")
    .get(repoId) as { owner: string; name: string } | undefined;
  return row ?? null;
};

/**
 * Merge a PR via GitHub API.
 */
const mergePROnGitHub = async (
  owner: string,
  repo: string,
  prNumber: number,
  token: string
): Promise<{ success: boolean; message: string }> => {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/merge`;

  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        ...GITHUB_HEADERS,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ merge_method: "squash" }),
    });

    if (response.ok)
      return { success: true, message: "PR merged successfully" };

    const body = await response.json().catch(() => ({}));
    const message = (body as { message?: string }).message || `HTTP ${response.status}`;

    if (response.status === 405)
      return { success: false, message: `PR not mergeable: ${message}` };
    if (response.status === 409)
      return { success: false, message: `Merge conflict: ${message}` };

    return { success: false, message: `Merge failed: ${message}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, message: `Merge request failed: ${message}` };
  }
};

/**
 * Delete a branch on GitHub.
 */
const deleteBranchOnGitHub = async (
  owner: string,
  repo: string,
  branch: string,
  token: string
): Promise<void> => {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`;
  try {
    const response = await fetch(url, {
      method: "DELETE",
      headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` },
    });
    if (response.ok || response.status === 422)
      logger.info({ owner, repo, branch }, "Admiral: Deleted branch");
    else
      logger.warn({ owner, repo, branch, status: response.status }, "Admiral: Failed to delete branch");
  } catch (err) {
    logger.warn({ err, owner, repo, branch }, "Admiral: Branch deletion failed");
  }
};

/**
 * Merge a PR for an issue.
 */
export const handleMergePR = async (
  projectId: string,
  input: { issue_id: string }
): Promise<ToolResult> => {
  const project = getProject(projectId);
  if (!project)
    return { success: false, message: "Project not found" };

  if (!project.github_account_id)
    return { success: false, message: "No GitHub account linked to project" };

  const account = getGitHubAccount(project.github_account_id);
  if (!account)
    return { success: false, message: "GitHub account not found" };

  const issue = issueRepo.getIssue(input.issue_id);
  if (!issue)
    return { success: false, message: "Issue not found" };

  if (issue.project_id !== projectId)
    return { success: false, message: "Issue belongs to a different project" };

  const prs = issuePRRepo.listIssuePRs(issue.id);
  const openPR = prs.find((pr) => pr.status === "open");
  if (!openPR)
    return { success: false, message: "No open PR found for this issue" };

  const repoInfo = getRepoInfo(openPR.repo_id);
  if (!repoInfo)
    return { success: false, message: "Repository not found" };

  const result = await mergePROnGitHub(
    repoInfo.owner,
    repoInfo.name,
    openPR.pr_number,
    account.oauth_token
  );

  if (result.success) {
    issuePRRepo.updateIssuePR(openPR.id, { status: "merged" });

    const oldStatus = issue.status;
    issueRepo.updateIssue(issue.id, { status: "done" });

    if (issue.branch_name)
      await deleteBranchOnGitHub(repoInfo.owner, repoInfo.name, issue.branch_name, account.oauth_token);

    postSystemComment(issue.id, projectId, `PR #${openPR.pr_number} merged by Admiral.`);

    eventBus.emit("issue.status_changed", {
      issue_id: issue.id,
      project_id: projectId,
      from: oldStatus,
      to: "done",
    });

    return {
      success: true,
      message: `Merged PR #${openPR.pr_number}`,
      data: { pr_number: openPR.pr_number, branch_deleted: !!issue.branch_name },
    };
  }

  return { success: false, message: result.message };
};

/**
 * Dispatch Captain agent to work on an issue.
 */
export const handleDispatchCaptain = async (
  projectId: string,
  input: { issue_id: string; instructions?: string }
): Promise<ToolResult> => {
  const captain = getCrewMember("captain");
  if (!captain)
    return { success: false, message: "Captain agent not found" };

  const issue = issueRepo.getIssue(input.issue_id);
  if (!issue)
    return { success: false, message: "Issue not found" };

  if (issue.project_id !== projectId)
    return { success: false, message: "Issue belongs to a different project" };

  if (input.instructions)
    postSystemComment(issue.id, projectId, `Admiral: ${input.instructions}`);

  try {
    await spawnAgent(captain, issue.id, projectId);
    return {
      success: true,
      message: `Dispatched Captain to work on "${issue.title}"`,
      data: { issue_id: issue.id, issue_title: issue.title },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, message: `Failed to dispatch Captain: ${message}` };
  }
};

/** Valid agent IDs for dispatch-agent (excludes captain and admiral) */
const DISPATCHABLE_AGENTS = ["engineer", "lead", "docs", "librarian"] as const;
type DispatchableAgent = (typeof DISPATCHABLE_AGENTS)[number];

/**
 * Check if an agent ID is dispatchable via dispatch-agent.
 */
const isDispatchableAgent = (agentId: string): agentId is DispatchableAgent => {
  return (DISPATCHABLE_AGENTS as readonly string[]).includes(agentId);
};

/**
 * Dispatch a specific agent to work on an issue.
 * Unlike dispatch-captain, this allows Admiral to directly spawn sub-agents.
 */
export const handleDispatchAgent = async (
  projectId: string,
  input: { issue_id: string; agent_id: string; instructions?: string }
): Promise<ToolResult> => {
  if (!isDispatchableAgent(input.agent_id)) {
    return {
      success: false,
      message: `Invalid agent_id "${input.agent_id}". Must be one of: ${DISPATCHABLE_AGENTS.join(", ")}`,
    };
  }

  const agent = getCrewMember(input.agent_id);
  if (!agent)
    return { success: false, message: `Agent "${input.agent_id}" not found` };

  const issue = issueRepo.getIssue(input.issue_id);
  if (!issue)
    return { success: false, message: "Issue not found" };

  if (issue.project_id !== projectId)
    return { success: false, message: "Issue belongs to a different project" };

  if (input.instructions)
    postSystemComment(issue.id, projectId, `Admiral: ${input.instructions}`);

  try {
    await spawnAgent(agent, issue.id, projectId);
    return {
      success: true,
      message: `Dispatched ${agent.name} to work on "${issue.title}"`,
      data: { issue_id: issue.id, issue_title: issue.title, agent_id: agent.id },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, message: `Failed to dispatch ${agent.name}: ${message}` };
  }
};

/**
 * Trigger a librarian codebase scan.
 */
export const handleScanCodebase = async (projectId: string): Promise<ToolResult> => {
  try {
    const runId = await spawnScan(projectId);
    return {
      success: true,
      message: "Librarian scan started",
      data: { agent_run_id: runId },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, message: `Failed to start scan: ${message}` };
  }
};
