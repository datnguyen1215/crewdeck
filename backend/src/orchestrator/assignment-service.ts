import { logger } from "../logger.js";
import type { EventBus } from "../events/bus.js";
import type { AgentAdapter } from "../agent/types.js";
import { agentSessionName } from "../agent/types.js";
import { buildAgentPrompt } from "../agent/prompt.js";
import { createWorktree, cleanupWorktree } from "../agent/worktree.js";
import { getProject } from "../db/repositories/projects.js";
import { listIssues, getIssue, updateIssue } from "../db/repositories/issues.js";
import { getAgent } from "../db/repositories/agents.js";
import { getCrewWithAgents } from "../db/repositories/crews.js";
import { listRepos } from "../db/repositories/repos.js";
import { getGitHubAccount } from "../db/repositories/github-accounts.js";
import { createComment, listComments } from "../db/repositories/comments.js";
import {
  createIssueAgent,
  updateIssueAgent,
} from "../db/repositories/issue-agents.js";
import {
  createSession,
  updateSession,
} from "../db/repositories/sessions.js";

// Execute an assign action triggered by the captain via CLI
export async function executeAssign(
  projectId: string,
  issueId: string,
  agentId: string,
  bus: EventBus,
  adapter: AgentAdapter,
): Promise<void> {
  const issue = getIssue(issueId);
  if (!issue) { logger.warn({ issueId }, "assign: issue not found"); return; }
  if (issue.project_id !== projectId) {
    logger.warn({ issueId, projectId }, "assign: issue does not belong to project");
    return;
  }
  if (!["open", "draft"].includes(issue.status)) {
    logger.warn({ issueId, status: issue.status }, "assign: issue is not in assignable state");
    return;
  }

  const agent = getAgent(agentId);
  if (!agent) { logger.warn({ agentId }, "assign: agent not found"); return; }

  const crew = getCrewWithAgents(projectId);
  if (!crew) return;
  if (agent.crew_id !== crew.id) {
    logger.warn({ agentId, crew_id: crew.id }, "assign: agent does not belong to project crew");
    return;
  }

  const project = getProject(projectId);
  if (!project) return;

  // Concurrency check
  const all = listIssues(projectId);
  const activeCount = all.filter((i) =>
    ["in_progress", "in_review", "feedback"].includes(i.status)
  ).length;
  if (activeCount >= project.max_concurrency) {
    logger.info({ projectId, activeCount, max: project.max_concurrency }, "assign: concurrency limit reached");
    createComment(issueId, {
      content: `Issue queued — concurrency limit reached (${activeCount}/${project.max_concurrency})`,
      author_type: "orchestrator",
    });
    return;
  }

  const updatedIssue = updateIssue(issueId, { assigned_agent_id: agentId, status: "in_progress" });
  const issueAgent = createIssueAgent({ issue_id: issueId, agent_id: agentId, role: "worker", status: "active", review_round: 0 });

  // Create worktree if repo is configured
  const repos = listRepos(projectId);
  let repo = repos.length > 0 ? repos[0] : null;
  let worktreePath = "/tmp";
  let createdBranchName: string | null = null;
  if (repo) {
    try {
      const wt = await createWorktree(repo, updatedIssue, repo.default_branch);
      worktreePath = wt.path;
      createdBranchName = wt.branchName;
    } catch (err) {
      logger.error({ err, issueId }, "assign: failed to create worktree, using /tmp");
      repo = null;
    }
  }

  const promptText = buildAgentPrompt(updatedIssue, agent, repo, {
    worktreePath,
    previousComments: repo ? listComments(issueId) : undefined,
  });

  const sessionName = agentSessionName(issueId, agentId, "worker");
  const session = createSession({
    project_id: projectId,
    session_type: "worker",
    agent_id: agentId,
    issue_id: issueId,
    tmux_session_name: sessionName,
    status: "running",
    context: {},
  });

  updateIssueAgent(issueAgent.id, { session_id: session.id });

  const ghAccount = project.github_account_id
    ? getGitHubAccount(project.github_account_id)
    : null;

  try {
    await adapter.spawn({
      sessionName,
      workdir: worktreePath,
      prompt: promptText,
      systemPrompt: agent.system_prompt,
      env: {
        CREWDECK_SESSION_ID: session.id,
        CREWDECK_AGENT_ID: agentId,
        CREWDECK_ISSUE_ID: issueId,
        CREWDECK_PROJECT_ID: projectId,
        ...(ghAccount ? { GH_TOKEN: ghAccount.oauth_token } : {}),
      },
    });
  } catch (err) {
    logger.error({ err, sessionName }, "assign: failed to spawn agent session");
    updateSession(session.id, { status: "error" });
    updateIssueAgent(issueAgent.id, { status: "error" });
    updateIssue(issueId, {
      status: issue.status,
      assigned_agent_id: issue.assigned_agent_id,
      worktree_path: issue.worktree_path ?? null,
      branch_name: issue.branch_name ?? null,
      base_branch: issue.base_branch ?? null,
    });
    if (repo && createdBranchName) {
      cleanupWorktree(repo, worktreePath, createdBranchName).catch((cleanErr) => {
        logger.warn({ cleanErr, worktreePath }, "assign: failed to clean up orphaned worktree");
      });
    }
    return;
  }

  bus.emit("issue.status_changed", { issue_id: issueId, project_id: projectId, from: issue.status, to: "in_progress" });
  bus.emit("issue.assigned", { issue_id: issueId, project_id: projectId, agent_id: agentId, agent_name: agent.name });
  bus.emit("session.started", {
    session_id: session.id,
    agent_id: agentId,
    issue_id: issueId,
    project_id: projectId,
    tmux_session_name: sessionName,
  });

  const comment = createComment(issueId, {
    content: `Assigned to ${agent.name} (${agent.title}). Session started.`,
    author_type: "orchestrator",
  });
  bus.emit("comment.added", { comment, project_id: projectId });
}
