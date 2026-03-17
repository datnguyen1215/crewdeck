import { logger } from "../logger.js";
import type { EventBus } from "../events/bus.js";
import type { AgentAdapter } from "../agent/types.js";
import { agentSessionName } from "../agent/types.js";
import { buildReviewerPrompt } from "../agent/prompt.js";
import { getProject } from "../db/repositories/projects.js";
import { getIssue, updateIssue } from "../db/repositories/issues.js";
import { getAgent } from "../db/repositories/agents.js";
import { getCrewWithAgents } from "../db/repositories/crews.js";
import { listRepos } from "../db/repositories/repos.js";
import { getGitHubAccount } from "../db/repositories/github-accounts.js";
import { createComment, listComments } from "../db/repositories/comments.js";
import {
  listIssueAgents,
  createIssueAgent,
  updateIssueAgent,
} from "../db/repositories/issue-agents.js";
import {
  createSession,
  updateSession,
} from "../db/repositories/sessions.js";

// Execute a route-review action triggered by the captain via CLI
export async function executeRouteReview(
  projectId: string,
  issueId: string,
  reviewerAgentId: string,
  bus: EventBus,
  adapter: AgentAdapter,
): Promise<void> {
  const issue = getIssue(issueId);
  if (!issue) { logger.warn({ issueId }, "route_review: issue not found"); return; }
  if (issue.project_id !== projectId) {
    logger.warn({ issueId, projectId }, "route_review: issue does not belong to project");
    return;
  }
  if (!["in_progress", "feedback"].includes(issue.status)) {
    logger.warn({ issueId, status: issue.status }, "route_review: issue is not in a reviewable state");
    return;
  }

  const reviewer = getAgent(reviewerAgentId);
  if (!reviewer) { logger.warn({ reviewerAgentId }, "route_review: reviewer not found"); return; }

  const crew = getCrewWithAgents(projectId);
  if (!crew) return;
  if (reviewer.crew_id !== crew.id) {
    logger.warn({ reviewerAgentId, crew_id: crew.id }, "route_review: reviewer does not belong to project crew");
    return;
  }

  const project = getProject(projectId);
  if (!project) return;

  const newRound = issue.status !== "in_review"
    ? (issue.current_review_round ?? 0) + 1
    : issue.current_review_round ?? 1;
  const updatedIssue = updateIssue(issueId, {
    status: "in_review",
    current_review_round: newRound,
  });

  const issueAgent = createIssueAgent({
    issue_id: issueId,
    agent_id: reviewerAgentId,
    role: "reviewer",
    status: "active",
    review_order: 1,
    review_round: newRound,
  });

  const repos = listRepos(projectId);
  const repo = repos.length > 0 ? repos[0] : null;
  const worktreePath = updatedIssue.worktree_path ?? "/tmp";
  const promptText = buildReviewerPrompt(updatedIssue, reviewer, repo, {
    worktreePath,
    branchName: updatedIssue.branch_name ?? "main",
    comments: repo ? listComments(issueId) : undefined,
  });

  const sessionName = agentSessionName(issueId, reviewerAgentId, "reviewer");
  const session = createSession({
    project_id: projectId,
    session_type: "reviewer",
    agent_id: reviewerAgentId,
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
      systemPrompt: reviewer.system_prompt,
      env: {
        CREWDECK_SESSION_ID: session.id,
        CREWDECK_AGENT_ID: reviewerAgentId,
        CREWDECK_ISSUE_ID: issueId,
        CREWDECK_PROJECT_ID: projectId,
        ...(ghAccount ? { GH_TOKEN: ghAccount.oauth_token } : {}),
      },
    });
  } catch (err) {
    logger.error({ err, sessionName }, "route_review: failed to spawn reviewer session");
    updateSession(session.id, { status: "error" });
    updateIssueAgent(issueAgent.id, { status: "error" });
    updateIssue(issueId, { status: issue.status, current_review_round: issue.current_review_round ?? null });
    return;
  }

  bus.emit("issue.status_changed", { issue_id: issueId, project_id: projectId, from: issue.status, to: "in_review" });
  bus.emit("issue.assigned", {
    issue_id: issueId,
    project_id: projectId,
    agent_id: reviewerAgentId,
    agent_name: reviewer.name,
  });
  bus.emit("session.started", {
    session_id: session.id,
    agent_id: reviewerAgentId,
    issue_id: issueId,
    project_id: projectId,
    tmux_session_name: sessionName,
  });

  const comment = createComment(issueId, {
    content: `Routing to ${reviewer.name} for code review (round ${updatedIssue.current_review_round}).`,
    author_type: "orchestrator",
  });
  bus.emit("comment.added", { comment, project_id: projectId });
}

// Handle a review verdict — update issue agents and issue status accordingly
export function handleReviewVerdict(
  issue_id: string,
  project_id: string,
  agent_id: string,
  verdict: string,
  bus: EventBus,
): void {
  const agents = listIssueAgents(issue_id);
  const reviewerRecord = agents
    .filter((ia) => ia.agent_id === agent_id && ia.role === "reviewer" && ia.status === "active")
    .at(-1);

  if (!reviewerRecord) return;

  if (verdict === "approved") {
    updateIssueAgent(reviewerRecord.id, { status: "approved" });

    const freshIssue = getIssue(issue_id);
    const currentRound = freshIssue?.current_review_round ?? null;
    const freshAgents = listIssueAgents(issue_id);
    const allForRound = freshAgents.filter(
      (ia) => ia.role === "reviewer" && ia.review_round === currentRound,
    );
    const allApproved = allForRound.every((ia) => ia.status === "approved");
    if (allApproved && allForRound.length > 0 && freshIssue?.status === "in_review") {
      const issue = updateIssue(issue_id, { status: "ready" });
      bus.emit("issue.status_changed", {
        issue_id,
        project_id,
        from: "in_review",
        to: "ready",
      });
      bus.emit("issue.approved", { issue });
    }
  } else if (verdict === "changes_requested") {
    updateIssueAgent(reviewerRecord.id, { status: "changes_requested" });
    const prevIssue = getIssue(issue_id);
    updateIssue(issue_id, { status: "feedback" });
    bus.emit("issue.status_changed", {
      issue_id,
      project_id,
      from: prevIssue?.status ?? "in_review",
      to: "feedback",
    });
  } else {
    logger.warn({ issue_id, agent_id, verdict }, "handleReviewVerdict: unknown verdict");
    updateIssueAgent(reviewerRecord.id, { status: "error" });
  }
}
