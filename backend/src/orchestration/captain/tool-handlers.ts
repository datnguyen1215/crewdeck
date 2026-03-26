/**
 * Tool Handlers
 *
 * Server-side business logic for orchestration actions (merge PR,
 * dispatch agent, scan codebase). Exposed via internal API routes.
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
import { IssueStatus, PRStatus } from "../../constants/statuses.js";

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
const getRepoInfo = (
  repoId: string,
): { owner: string; name: string } | null => {
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
  token: string,
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
};

/**
 * Delete a branch on GitHub.
 */
const deleteBranchOnGitHub = async (
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<void> => {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`;
  try {
    const response = await fetch(url, {
      method: "DELETE",
      headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` },
    });
    if (response.ok || response.status === 422)
      logger.info({ owner, repo, branch }, "Deleted branch after merge");
    else
      logger.warn(
        { owner, repo, branch, status: response.status },
        "Failed to delete branch after merge",
      );
  } catch (err) {
    logger.warn({ err, owner, repo, branch }, "Branch deletion failed");
  }
};

/**
 * Merge a PR for an issue.
 */
export const handleMergePR = async (
  projectId: string,
  input: { issue_id: string },
): Promise<ToolResult> => {
  const project = getProject(projectId);
  if (!project) return { success: false, message: "Project not found" };

  if (!project.auto_merge)
    return {
      success: false,
      message: "Auto-merge is disabled for this project",
    };

  if (!project.github_account_id)
    return { success: false, message: "No GitHub account linked to project" };

  const account = getGitHubAccount(project.github_account_id);
  if (!account) return { success: false, message: "GitHub account not found" };

  const issue = issueRepo.getIssue(input.issue_id);
  if (!issue) return { success: false, message: "Issue not found" };

  if (issue.project_id !== projectId)
    return { success: false, message: "Issue belongs to a different project" };

  const prs = issuePRRepo.listIssuePRs(issue.id);
  const openPR = prs.find((pr) => pr.status === PRStatus.OPEN);
  if (!openPR)
    return { success: false, message: "No open PR found for this issue" };

  const repoInfo = getRepoInfo(openPR.repo_id);
  if (!repoInfo) return { success: false, message: "Repository not found" };

  const result = await mergePROnGitHub(
    repoInfo.owner,
    repoInfo.name,
    openPR.pr_number,
    account.gh_token,
  );

  if (result.success) {
    issuePRRepo.updateIssuePR(openPR.id, { status: PRStatus.MERGED });

    const oldStatus = issue.status;
    issueRepo.updateIssue(issue.id, { status: IssueStatus.DONE });

    if (issue.branch_name)
      await deleteBranchOnGitHub(
        repoInfo.owner,
        repoInfo.name,
        issue.branch_name,
        account.gh_token,
      );

    postSystemComment(
      issue.id,
      projectId,
      `PR #${openPR.pr_number} merged.`,
      "captain",
    );

    eventBus.emit("issue.status_changed", {
      issue_id: issue.id,
      project_id: projectId,
      from: oldStatus,
      to: IssueStatus.DONE,
      actor_type: "agent",
      actor_id: "captain",
    });

    return {
      success: true,
      message: `Merged PR #${openPR.pr_number}`,
      data: {
        pr_number: openPR.pr_number,
        branch_deleted: !!issue.branch_name,
      },
    };
  }

  return { success: false, message: result.message };
};

/**
 * Create a GitHub PR for an issue.
 * Looks up issue branch/repo info, calls GitHub API, creates IssuePR record.
 */
export const handleCreatePR = async (
  projectId: string,
  input: { issue_id: string },
): Promise<ToolResult> => {
  const project = getProject(projectId);
  if (!project) return { success: false, message: "Project not found" };

  if (!project.github_account_id)
    return { success: false, message: "No GitHub account linked to project" };

  const account = getGitHubAccount(project.github_account_id);
  if (!account) return { success: false, message: "GitHub account not found" };

  const issue = issueRepo.getIssue(input.issue_id);
  if (!issue) return { success: false, message: "Issue not found" };

  if (issue.project_id !== projectId)
    return { success: false, message: "Issue belongs to a different project" };

  if (!issue.branch_name)
    return { success: false, message: "Issue has no branch_name set" };

  if (!issue.repo_id)
    return { success: false, message: "Issue has no repo_id set" };

  const repoInfo = getRepoInfo(issue.repo_id);
  if (!repoInfo) return { success: false, message: "Repository not found" };

  const baseBranch = issue.base_branch || "main";

  // Check for existing open PR
  const existingPRs = issuePRRepo.listIssuePRs(issue.id);
  const openPR = existingPRs.find((pr) => pr.status === PRStatus.OPEN);
  if (openPR)
    return {
      success: false,
      message: `Issue already has an open PR (#${openPR.pr_number})`,
    };

  // Create PR via GitHub API
  const url = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.name}/pulls`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...GITHUB_HEADERS,
        Authorization: `Bearer ${account.gh_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: issue.title,
        body: issue.description || "",
        head: issue.branch_name,
        base: baseBranch,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const message =
        (body as { message?: string }).message || `HTTP ${response.status}`;
      return { success: false, message: `Failed to create PR: ${message}` };
    }

    const prData = (await response.json()) as {
      number: number;
      html_url: string;
    };

    // Create IssuePR record
    const issuePR = issuePRRepo.createIssuePR({
      issue_id: issue.id,
      repo_id: issue.repo_id,
      pr_number: prData.number,
      pr_url: prData.html_url,
      status: PRStatus.OPEN,
    });

    // Update issue status to pr_created
    const oldStatus = issue.status;
    issueRepo.updateIssue(issue.id, { status: IssueStatus.PR_CREATED });

    postSystemComment(
      issue.id,
      projectId,
      `PR #${prData.number} created: ${prData.html_url}`,
      "captain",
    );

    eventBus.emit("pr.created", {
      issue_pr: issuePR,
      project_id: projectId,
    });

    if (oldStatus !== IssueStatus.PR_CREATED) {
      eventBus.emit("issue.status_changed", {
        issue_id: issue.id,
        project_id: projectId,
        from: oldStatus,
        to: IssueStatus.PR_CREATED,
        actor_type: "agent",
        actor_id: "captain",
      });
    }

    return {
      success: true,
      message: `Created PR #${prData.number}`,
      data: {
        pr_number: prData.number,
        pr_url: prData.html_url,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, message: `PR creation failed: ${message}` };
  }
};

/** Valid agent IDs for dispatch-agent */
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
 */
export const handleDispatchAgent = async (
  projectId: string,
  input: { issue_id: string; agent_id: string; instructions?: string },
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
  if (!issue) return { success: false, message: "Issue not found" };

  if (issue.project_id !== projectId)
    return { success: false, message: "Issue belongs to a different project" };

  if (input.instructions)
    postSystemComment(issue.id, projectId, input.instructions, "captain");

  try {
    await spawnAgent(agent, issue.id, projectId);
    return {
      success: true,
      message: `Dispatched ${agent.name} to work on "${issue.title}"`,
      data: {
        issue_id: issue.id,
        issue_title: issue.title,
        agent_id: agent.id,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      success: false,
      message: `Failed to dispatch ${agent.name}: ${message}`,
    };
  }
};

/**
 * Trigger a librarian codebase scan.
 */
export const handleScanCodebase = async (
  projectId: string,
): Promise<ToolResult> => {
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
