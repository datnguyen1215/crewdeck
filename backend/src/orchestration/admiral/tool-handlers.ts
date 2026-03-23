/**
 * Admiral Tool Handlers
 *
 * Implementations for each Admiral tool. These are called when the LLM
 * invokes a tool during conversation.
 */
import { db } from "../../db/index.js";
import { eventBus } from "../../events/bus.js";
import { logger } from "../../logger.js";
import * as issueRepo from "../../db/repositories/issues.js";
import * as commentRepo from "../../db/repositories/comments.js";
import * as knowledgeRepo from "../../db/repositories/knowledge.js";
import * as issuePRRepo from "../../db/repositories/issue-prs.js";
import { getGitHubAccount } from "../../db/repositories/github-accounts.js";
import { getProject } from "../../db/repositories/projects.js";
import { getCrewMember } from "../crew.js";
import { spawnAgent, spawnScan } from "../spawner.js";
import { postSystemComment } from "../spawner.js";

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
function getRepoInfo(repoId: string): { owner: string; name: string } | null {
  const row = db
    .prepare("SELECT owner, name FROM Repo WHERE id = ?")
    .get(repoId) as { owner: string; name: string } | undefined;
  return row ?? null;
}

/**
 * Merge a PR via GitHub API.
 */
async function mergePROnGitHub(
  owner: string,
  repo: string,
  prNumber: number,
  token: string
): Promise<{ success: boolean; message: string }> {
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

    if (response.ok) {
      return { success: true, message: "PR merged successfully" };
    }

    const body = await response.json().catch(() => ({}));
    const message = (body as { message?: string }).message || `HTTP ${response.status}`;

    if (response.status === 405) {
      return { success: false, message: `PR not mergeable: ${message}` };
    }
    if (response.status === 409) {
      return { success: false, message: `Merge conflict: ${message}` };
    }

    return { success: false, message: `Merge failed: ${message}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, message: `Merge request failed: ${message}` };
  }
}

/**
 * Delete a branch on GitHub.
 */
async function deleteBranchOnGitHub(
  owner: string,
  repo: string,
  branch: string,
  token: string
): Promise<void> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`;
  try {
    const response = await fetch(url, {
      method: "DELETE",
      headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` },
    });
    if (response.ok || response.status === 422) {
      logger.info({ owner, repo, branch }, "Admiral: Deleted branch");
    } else {
      logger.warn({ owner, repo, branch, status: response.status }, "Admiral: Failed to delete branch");
    }
  } catch (err) {
    logger.warn({ err, owner, repo, branch }, "Admiral: Branch deletion failed");
  }
}

// Tool handler implementations

export async function handleMergePR(
  projectId: string,
  input: { issue_id: string }
): Promise<ToolResult> {
  const project = getProject(projectId);
  if (!project) {
    return { success: false, message: "Project not found" };
  }

  if (!project.github_account_id) {
    return { success: false, message: "No GitHub account linked to project" };
  }

  const account = getGitHubAccount(project.github_account_id);
  if (!account) {
    return { success: false, message: "GitHub account not found" };
  }

  const issue = issueRepo.getIssue(input.issue_id);
  if (!issue) {
    return { success: false, message: "Issue not found" };
  }

  if (issue.project_id !== projectId) {
    return { success: false, message: "Issue belongs to a different project" };
  }

  // Find open PR for this issue
  const prs = issuePRRepo.listIssuePRs(issue.id);
  const openPR = prs.find((pr) => pr.status === "open");
  if (!openPR) {
    return { success: false, message: "No open PR found for this issue" };
  }

  const repoInfo = getRepoInfo(openPR.repo_id);
  if (!repoInfo) {
    return { success: false, message: "Repository not found" };
  }

  const result = await mergePROnGitHub(
    repoInfo.owner,
    repoInfo.name,
    openPR.pr_number,
    account.oauth_token
  );

  if (result.success) {
    // Update PR status
    issuePRRepo.updateIssuePR(openPR.id, { status: "merged" });

    // Update issue status
    const oldStatus = issue.status;
    issueRepo.updateIssue(issue.id, { status: "done" });

    // Delete branch
    if (issue.branch_name) {
      await deleteBranchOnGitHub(repoInfo.owner, repoInfo.name, issue.branch_name, account.oauth_token);
    }

    // Post comment
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
}

export async function handleDispatchCaptain(
  projectId: string,
  input: { issue_id: string; instructions?: string }
): Promise<ToolResult> {
  const captain = getCrewMember("captain");
  if (!captain) {
    return { success: false, message: "Captain agent not found" };
  }

  const issue = issueRepo.getIssue(input.issue_id);
  if (!issue) {
    return { success: false, message: "Issue not found" };
  }

  if (issue.project_id !== projectId) {
    return { success: false, message: "Issue belongs to a different project" };
  }

  // Post instructions as a system comment if provided
  if (input.instructions) {
    postSystemComment(issue.id, projectId, `Admiral: ${input.instructions}`);
  }

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
}

export function handleCreateIssue(
  projectId: string,
  input: { title: string; description: string }
): ToolResult {
  const issue = issueRepo.createIssue(projectId, {
    title: input.title,
    description: input.description,
    created_by: "admiral",
  });

  eventBus.emit("issue.created", { issue });

  return {
    success: true,
    message: `Created issue: ${issue.title}`,
    data: { issue_id: issue.id, title: issue.title },
  };
}

const VALID_STATUSES = [
  "open",
  "in_progress",
  "pr_created",
  "pr_conflict",
  "pr_failed_actions",
  "pr_ready_to_merge",
  "done",
];

export function handleUpdateIssue(
  projectId: string,
  input: { issue_id: string; title?: string; description?: string; status?: string }
): ToolResult {
  const issue = issueRepo.getIssue(input.issue_id);
  if (!issue) {
    return { success: false, message: "Issue not found" };
  }

  if (issue.project_id !== projectId) {
    return { success: false, message: "Issue belongs to a different project" };
  }

  if (input.status && !VALID_STATUSES.includes(input.status)) {
    return {
      success: false,
      message: `Invalid status: ${input.status}. Must be one of: ${VALID_STATUSES.join(", ")}`,
    };
  }

  const oldStatus = issue.status;
  const updates: { title?: string; description?: string; status?: string } = {};

  if (input.title) updates.title = input.title;
  if (input.description) updates.description = input.description;
  if (input.status) updates.status = input.status;

  if (Object.keys(updates).length === 0) {
    return { success: false, message: "No updates provided" };
  }

  const updated = issueRepo.updateIssue(input.issue_id, updates);

  if (input.status && input.status !== oldStatus) {
    eventBus.emit("issue.status_changed", {
      issue_id: issue.id,
      project_id: projectId,
      from: oldStatus,
      to: input.status,
    });
  }

  eventBus.emit("issue.updated", {
    issue_id: issue.id,
    project_id: projectId,
    changes: updates,
  });

  return {
    success: true,
    message: `Updated issue: ${updated.title}`,
    data: { issue_id: updated.id, changes: updates },
  };
}

export function handleListIssues(
  projectId: string,
  input: { status?: string[]; limit?: number }
): ToolResult {
  const issues = issueRepo.listIssues(projectId, {
    status: input.status,
  });

  const limit = input.limit ?? 20;
  const limited = issues.slice(0, limit);

  const summary = limited.map((i) => ({
    id: i.id,
    title: i.title,
    status: i.status,
    running_agent: i.running_agent_id || null,
  }));

  return {
    success: true,
    message: `Found ${issues.length} issue(s)`,
    data: { issues: summary, total: issues.length, showing: limited.length },
  };
}

export function handleGetIssue(
  projectId: string,
  input: { issue_id: string }
): ToolResult {
  const issue = issueRepo.getIssueWithDetails(input.issue_id);
  if (!issue) {
    return { success: false, message: "Issue not found" };
  }

  // Verify issue belongs to project
  if (issue.project_id !== projectId) {
    return { success: false, message: "Issue not found in this project" };
  }

  return {
    success: true,
    message: `Retrieved issue: ${issue.title}`,
    data: {
      id: issue.id,
      title: issue.title,
      description: issue.description,
      status: issue.status,
      chain_depth: issue.chain_depth,
      branch_name: issue.branch_name,
      comments: issue.comments.map((c) => ({
        author_type: c.author_type,
        author_id: c.author_id,
        content: c.content,
        created_at: c.created_at,
      })),
      prs: issue.issue_prs.map((pr) => ({
        pr_number: pr.pr_number,
        pr_url: pr.pr_url,
        status: pr.status,
      })),
    },
  };
}

export function handleAddComment(
  projectId: string,
  input: { issue_id: string; content: string }
): ToolResult {
  const issue = issueRepo.getIssue(input.issue_id);
  if (!issue) {
    return { success: false, message: "Issue not found" };
  }

  if (issue.project_id !== projectId) {
    return { success: false, message: "Issue belongs to a different project" };
  }

  const comment = commentRepo.createComment(issue.id, {
    content: input.content,
    author_type: "agent",
    author_id: "admiral",
  });

  eventBus.emit("comment.added", { comment, project_id: projectId });

  return {
    success: true,
    message: "Comment added",
    data: { comment_id: comment.id },
  };
}

export async function handleScanCodebase(projectId: string): Promise<ToolResult> {
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
}

export function handleListKnowledge(
  projectId: string,
  input: { category?: string }
): ToolResult {
  let entries = knowledgeRepo.listByProject(projectId);

  if (input.category) {
    entries = entries.filter((e) => e.category === input.category);
  }

  const summary = entries.map((e) => ({
    id: e.id,
    title: e.title,
    category: e.category,
  }));

  return {
    success: true,
    message: `Found ${entries.length} knowledge entry(s)`,
    data: { entries: summary },
  };
}

export function handleCreateKnowledge(
  projectId: string,
  input: { title: string; category: string; content: string }
): ToolResult {
  const entry = knowledgeRepo.create(projectId, {
    title: input.title,
    category: input.category,
    content: input.content,
    source: "admiral",
  });

  return {
    success: true,
    message: `Created knowledge entry: ${entry.title}`,
    data: { knowledge_id: entry.id, title: entry.title },
  };
}

export function handleUpdateKnowledge(
  projectId: string,
  input: { knowledge_id: string; title?: string; category?: string; content?: string }
): ToolResult {
  const entry = knowledgeRepo.getById(input.knowledge_id);
  if (!entry) {
    return { success: false, message: "Knowledge entry not found" };
  }

  if (entry.project_id !== projectId) {
    return { success: false, message: "Knowledge entry not found in this project" };
  }

  const updates: { title?: string; category?: string; content?: string } = {};
  if (input.title) updates.title = input.title;
  if (input.category) updates.category = input.category;
  if (input.content) updates.content = input.content;

  if (Object.keys(updates).length === 0) {
    return { success: false, message: "No updates provided" };
  }

  const updated = knowledgeRepo.update(input.knowledge_id, updates);

  return {
    success: true,
    message: `Updated knowledge entry: ${updated.title}`,
    data: { knowledge_id: updated.id },
  };
}

export function handleDeleteKnowledge(
  projectId: string,
  input: { knowledge_id: string }
): ToolResult {
  const entry = knowledgeRepo.getById(input.knowledge_id);
  if (!entry) {
    return { success: false, message: "Knowledge entry not found" };
  }

  if (entry.project_id !== projectId) {
    return { success: false, message: "Knowledge entry not found in this project" };
  }

  knowledgeRepo.remove(input.knowledge_id);

  return {
    success: true,
    message: `Deleted knowledge entry: ${entry.title}`,
    data: { knowledge_id: entry.id },
  };
}

/**
 * Execute a tool by name with the given input.
 */
export async function executeTool(
  toolName: string,
  projectId: string,
  input: Record<string, unknown>
): Promise<ToolResult> {
  switch (toolName) {
    case "merge_pr":
      return handleMergePR(projectId, input as { issue_id: string });

    case "dispatch_captain":
      return handleDispatchCaptain(projectId, input as { issue_id: string; instructions?: string });

    case "create_issue":
      return handleCreateIssue(projectId, input as { title: string; description: string });

    case "update_issue":
      return handleUpdateIssue(projectId, input as {
        issue_id: string;
        title?: string;
        description?: string;
        status?: string;
      });

    case "list_issues":
      return handleListIssues(projectId, input as { status?: string[]; limit?: number });

    case "get_issue":
      return handleGetIssue(projectId, input as { issue_id: string });

    case "add_comment":
      return handleAddComment(projectId, input as { issue_id: string; content: string });

    case "scan_codebase":
      return handleScanCodebase(projectId);

    case "list_knowledge":
      return handleListKnowledge(projectId, input as { category?: string });

    case "create_knowledge":
      return handleCreateKnowledge(projectId, input as {
        title: string;
        category: string;
        content: string;
      });

    case "update_knowledge":
      return handleUpdateKnowledge(projectId, input as {
        knowledge_id: string;
        title?: string;
        category?: string;
        content?: string;
      });

    case "delete_knowledge":
      return handleDeleteKnowledge(projectId, input as { knowledge_id: string });

    default:
      return { success: false, message: `Unknown tool: ${toolName}` };
  }
}
