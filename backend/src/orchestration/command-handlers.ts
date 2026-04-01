/**
 * Command Handlers
 *
 * Server-side business logic for orchestration commands (merge PR, create PR, create issue, scan codebase).
 * Exposed via internal API routes and callable from comment-based commands.
 */
import { db } from "../db/index.js";
import { eventBus } from "../events/bus.js";
import { logger } from "../logger.js";
import * as issueRepo from "../db/repositories/issues.js";
import * as issuePRRepo from "../db/repositories/issue-prs.js";
import { getVCSAccount } from "../db/repositories/vcs-accounts.js";
import { getProject } from "../db/repositories/projects.js";
import { getCrewMember } from "./crew.js";
import { spawnAgent, spawnScan, postSystemComment } from "./spawner.js";
import { IssueStatus, PRStatus } from "../constants/statuses.js";
import { getProvider } from "../vcs/registry.js";
import { isApprovedToMerge } from "./approval-store.js";
import { resolveIssueId } from "./issue-resolver.js";

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
 * Merge a PR for an issue.
 */
export const handleMergePR = async (
  projectId: string,
  input: { issue_id: string },
): Promise<ToolResult> => {
  const project = getProject(projectId);
  if (!project) return { success: false, message: "Project not found" };

  const resolvedId = resolveIssueId(input.issue_id, projectId);
  if (!resolvedId) return { success: false, message: "Issue not found" };

  if (!project.auto_merge && !isApprovedToMerge(resolvedId))
    return {
      success: false,
      message: "Auto-merge is disabled for this project",
    };

  if (!project.vcs_account_id)
    return { success: false, message: "No GitHub account linked to project" };

  const account = getVCSAccount(project.vcs_account_id);
  if (!account) return { success: false, message: "GitHub account not found" };

  const issue = issueRepo.getIssue(resolvedId)!;

  if (issue.project_id !== projectId)
    return { success: false, message: "Issue belongs to a different project" };

  if (issue.status !== IssueStatus.PR_READY_TO_MERGE)
    return {
      success: false,
      message: `Cannot merge: issue status is '${issue.status}', must be 'pr_ready_to_merge'. Wait for CI to complete.`,
    };

  const prs = issuePRRepo.listIssuePRs(issue.id);
  const openPR = prs.find((pr) => pr.status === PRStatus.OPEN);
  if (!openPR)
    return { success: false, message: "No open PR found for this issue" };

  const repoInfo = getRepoInfo(openPR.repo_id);
  if (!repoInfo) return { success: false, message: "Repository not found" };

  // Use VCS provider for merge operations
  const vcsClient = getProvider("github");
  const result = await vcsClient.mergePR({
    owner: repoInfo.owner,
    repo: repoInfo.name,
    prNumber: openPR.pr_number,
    token: account.token,
  });

  if (result.success) {
    issuePRRepo.updateIssuePR(openPR.id, { status: PRStatus.MERGED });

    const oldStatus = issue.status;
    issueRepo.updateIssue(issue.id, { status: IssueStatus.DONE });

    if (issue.branch_name) {
      await vcsClient.deleteBranch({
        owner: repoInfo.owner,
        repo: repoInfo.name,
        branch: issue.branch_name,
        token: account.token,
      });
    }

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

  if (!project.vcs_account_id)
    return { success: false, message: "No GitHub account linked to project" };

  const account = getVCSAccount(project.vcs_account_id);
  if (!account) return { success: false, message: "GitHub account not found" };

  const resolvedId = resolveIssueId(input.issue_id, projectId);
  if (!resolvedId) return { success: false, message: "Issue not found" };

  const issue = issueRepo.getIssue(resolvedId)!;

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

  // Build PR body with structured format
  let prBody = `## Summary\n${issue.title}`;
  if (issue.description) {
    prBody += `\n\n## Description\n${issue.description}`;
  }

  // Create PR via VCS provider
  const vcsClient = getProvider("github");
  try {
    const prData = await vcsClient.createPR({
      owner: repoInfo.owner,
      repo: repoInfo.name,
      head: issue.branch_name,
      base: baseBranch,
      title: issue.title,
      body: prBody,
      token: account.token,
    });

    // Create IssuePR record
    const issuePR = issuePRRepo.createIssuePR({
      issue_id: issue.id,
      repo_id: issue.repo_id,
      pr_number: prData.number,
      pr_url: prData.url,
      status: PRStatus.OPEN,
    });

    // Update issue status to pr_created
    const oldStatus = issue.status;
    issueRepo.updateIssue(issue.id, { status: IssueStatus.PR_CREATED });

    postSystemComment(
      issue.id,
      projectId,
      `PR #${prData.number} created: ${prData.url}`,
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
        pr_url: prData.url,
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

  const resolvedId = resolveIssueId(input.issue_id, projectId);
  if (!resolvedId) return { success: false, message: "Issue not found" };

  const issue = issueRepo.getIssue(resolvedId)!;

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

/**
 * Create a new issue.
 */
export const handleCreateIssue = (
  projectId: string,
  input: { title: string; description?: string },
): ToolResult => {
  try {
    const project = getProject(projectId);
    const baseBranch = project?.default_base_branch || "main";
    const issue = issueRepo.createIssue(projectId, {
      title: input.title,
      description: input.description ?? "",
      created_by: "agent",
      base_branch: baseBranch,
    });
    eventBus.emit("issue.created", { issue });
    return {
      success: true,
      message: `Created issue: ${issue.title}`,
      data: { issue_id: issue.id },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, message: `Failed to create issue: ${message}` };
  }
};
