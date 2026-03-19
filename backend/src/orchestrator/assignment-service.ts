import { logger } from "../logger.js";
import type { EventBus } from "../events/bus.js";
import type { AgentAdapter } from "../agent/types.js";
import { agentSessionName } from "../agent/types.js";
import { buildAgentPrompt } from "../agent/prompt.js";
import { createWorktree, cleanupWorktree } from "../agent/worktree.js";
import { getProject } from "../db/repositories/projects.js";
import {
  listIssues,
  getIssue,
  updateIssue,
} from "../db/repositories/issues.js";
import { getAgent, updateAgent } from "../db/repositories/agents.js";
import { getCrewWithAgents } from "../db/repositories/crews.js";
import { listRepos } from "../db/repositories/repos.js";
import { getGitHubAccount } from "../db/repositories/github-accounts.js";
import { config } from "../config.js";
import { createComment, listComments } from "../db/repositories/comments.js";
import {
  createIssueAgent,
  listIssueAgents,
  updateIssueAgent,
} from "../db/repositories/issue-agents.js";
import {
  createSession,
  listSessions,
  updateSession,
} from "../db/repositories/sessions.js";
import { getEnvironmentVariablesMap } from "../db/repositories/environment-variables.js";

// Execute an assign action triggered by the captain via CLI.
// This only links the agent to the issue and prepares the worktree.
// The captain must separately call `sessions start` to spawn the tmux session.
export async function executeAssign(
  projectId: string,
  issueId: string,
  agentId: string,
  bus: EventBus,
): Promise<void> {
  const issue = getIssue(issueId);
  if (!issue) {
    logger.warn({ issueId }, "assign: issue not found");
    return;
  }
  if (issue.project_id !== projectId) {
    logger.warn(
      { issueId, projectId },
      "assign: issue does not belong to project",
    );
    return;
  }
  const reassignable = ["in_progress", "feedback"];
  let isReassignment = false;
  if (!["open", "draft"].includes(issue.status)) {
    if (!reassignable.includes(issue.status)) {
      logger.warn(
        { issueId, status: issue.status },
        "assign: issue is not in assignable state",
      );
      return;
    }

    const runningSessions = listSessions(projectId, {
      issue_id: issueId,
      status: "running",
    });
    if (runningSessions.length > 0) {
      logger.warn(
        { issueId, status: issue.status, sessions: runningSessions.length },
        "assign: issue has an active running session, skipping re-assignment",
      );
      return;
    }

    const staleAgents = listIssueAgents(issueId).filter(
      (ia) => ia.status === "active",
    );
    for (const ia of staleAgents) {
      updateIssueAgent(ia.id, { status: "error" });
    }

    isReassignment = true;
    logger.info(
      { issueId, status: issue.status },
      "assign: re-assigning issue after previous session ended",
    );
  }

  const agent = getAgent(agentId);
  if (!agent) {
    logger.warn({ agentId }, "assign: agent not found");
    return;
  }

  const crew = getCrewWithAgents(projectId);
  if (!crew) return;
  if (agent.crew_id !== crew.id) {
    logger.warn(
      { agentId, crew_id: crew.id },
      "assign: agent does not belong to project crew",
    );
    return;
  }

  const project = getProject(projectId);
  if (!project) return;

  const all = listIssues(projectId);
  const activeCount = all.filter(
    (i) =>
      ["in_progress", "in_review", "feedback"].includes(i.status) &&
      !(isReassignment && i.id === issueId),
  ).length;
  if (activeCount >= project.max_concurrency) {
    logger.info(
      { projectId, activeCount, max: project.max_concurrency },
      "assign: concurrency limit reached",
    );
    createComment(issueId, {
      content: `Issue queued — concurrency limit reached (${activeCount}/${project.max_concurrency})`,
      author_type: "orchestrator",
    });
    return;
  }

  updateIssue(issueId, {
    assigned_agent_id: agentId,
    status: "in_progress",
  });

  updateAgent(agentId, { status: "active" });

  const existingIa = listIssueAgents(issueId).find(
    (ia) =>
      ia.agent_id === agentId &&
      ia.role === "worker" &&
      (ia.review_round ?? 0) === 0,
  );
  existingIa
    ? updateIssueAgent(existingIa.id, { status: "active", session_id: null })
    : createIssueAgent({
        issue_id: issueId,
        agent_id: agentId,
        role: "worker",
        status: "active",
        review_round: 0,
      });

  bus.emit("issue.status_changed", {
    issue_id: issueId,
    project_id: projectId,
    from: issue.status,
    to: "in_progress",
  });
  bus.emit("issue.assigned", {
    issue_id: issueId,
    project_id: projectId,
    agent_id: agentId,
    agent_name: agent.name,
  });

  const comment = createComment(issueId, {
    content: `Assigned to ${agent.name} (${agent.title}).`,
    author_type: "orchestrator",
  });
  bus.emit("comment.added", { comment, project_id: projectId });
}

// Spawn an agent's tmux session for a specific issue.
// Called by the captain via `crewdeck sessions start <agent_id> --issue <issue_id>`.
export async function executeSpawnSession(
  projectId: string,
  issueId: string,
  agentId: string,
  bus: EventBus,
  adapter: AgentAdapter,
): Promise<void> {
  const issue = getIssue(issueId);
  if (!issue) {
    logger.warn({ issueId }, "spawn: issue not found");
    return;
  }

  const agent = getAgent(agentId);
  if (!agent) {
    logger.warn({ agentId }, "spawn: agent not found");
    return;
  }

  // Don't double-spawn
  const runningSessions = listSessions(projectId, {
    issue_id: issueId,
    status: "running",
  });
  if (runningSessions.some((s) => s.agent_id === agentId)) {
    logger.warn(
      { issueId, agentId },
      "spawn: agent already has a running session for this issue",
    );
    return;
  }

  const project = getProject(projectId);
  if (!project) return;

  // Create worktree if repo is configured and issue doesn't already have one
  const repos = listRepos(projectId);
  let repo = repos.length > 0 ? repos[0] : null;
  let worktreePath = issue.worktree_path ?? "/tmp";
  let createdBranchName: string | null = null;
  if (repo && !issue.worktree_path) {
    try {
      const wt = await createWorktree(repo, issue, repo.default_branch);
      worktreePath = wt.path;
      createdBranchName = wt.branchName;
    } catch (err) {
      logger.error(
        { err, issueId },
        "spawn: failed to create worktree, using /tmp",
      );
      repo = null;
    }
  }

  if (createdBranchName) {
    updateIssue(issueId, {
      worktree_path: worktreePath,
      branch_name: createdBranchName,
      base_branch: repo!.default_branch,
    });
  }

  const promptText = buildAgentPrompt(issue, agent, repo, {
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

  // Link session to IssueAgent if one exists
  const ia = listIssueAgents(issueId).find(
    (ia) => ia.agent_id === agentId && ia.status === "active",
  );
  if (ia) updateIssueAgent(ia.id, { session_id: session.id });

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
        ...getEnvironmentVariablesMap(projectId),
        CREWDECK_SESSION_ID: session.id,
        CREWDECK_AGENT_ID: agentId,
        CREWDECK_ISSUE_ID: issueId,
        CREWDECK_PROJECT_ID: projectId,
        CREWDECK_API_URL: `http://${config.host}:${config.port}/api/v1`,
        ...(ghAccount ? { GH_TOKEN: ghAccount.oauth_token } : {}),
      },
    });
  } catch (err) {
    logger.error({ err, sessionName }, "spawn: failed to spawn agent session");
    updateSession(session.id, { status: "error" });
    if (ia) updateIssueAgent(ia.id, { status: "error" });
    if (repo && createdBranchName) {
      cleanupWorktree(repo, worktreePath, createdBranchName).catch(
        (cleanErr) => {
          logger.warn(
            { cleanErr, worktreePath },
            "spawn: failed to clean up orphaned worktree",
          );
        },
      );
    }
    return;
  }

  bus.emit("session.started", {
    session_id: session.id,
    agent_id: agentId,
    issue_id: issueId,
    project_id: projectId,
    tmux_session_name: sessionName,
  });

  const comment = createComment(issueId, {
    content: `Session started for ${agent.name}.`,
    author_type: "orchestrator",
  });
  bus.emit("comment.added", { comment, project_id: projectId });
}
