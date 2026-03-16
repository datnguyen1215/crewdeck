import { logger } from "../logger.js";
import { eventBus } from "../events/bus.js";
import type { EventBus } from "../events/bus.js";
import type { AgentAdapter } from "../agent/types.js";
import { agentSessionName, captainSessionName } from "../agent/types.js";
import { buildAgentPrompt, buildReviewerPrompt } from "../agent/prompt.js";
import { createWorktree, cleanupWorktree } from "../agent/worktree.js";
import { escapeXml } from "../utils/xml.js";
import { getProject, updateProject } from "../db/repositories/projects.js";
import { listIssues, getIssue, updateIssue } from "../db/repositories/issues.js";
import { getAgent, getCaptain } from "../db/repositories/agents.js";
import { getCrewWithAgents } from "../db/repositories/crews.js";
import { listRepos } from "../db/repositories/repos.js";
import { getGitHubAccount } from "../db/repositories/github-accounts.js";
import { createComment, listComments } from "../db/repositories/comments.js";
import { listCaptainHistory } from "../db/repositories/captain-history.js";
import {
  listIssueAgents,
  createIssueAgent,
  updateIssueAgent,
} from "../db/repositories/issue-agents.js";
import {
  createSession,
  updateSession,
} from "../db/repositories/sessions.js";
import { config } from "../config.js";

// Build the initial prompt that tells the captain what CLI commands are available
// and provides any saved decision history for context continuity.
function buildCaptainInitialPrompt(projectId: string, maxConcurrency: number): string {
  let prompt = `You are the captain of this project. You drive all decisions using the crewdeck CLI.

## Available Commands

\`\`\`
crewdeck issues list              — list all project issues
crewdeck issues get <issue_id>    — get issue details
crewdeck agents list              — list project agents (with idle/busy status)
crewdeck assign <issue_id> <agent_id>          — assign an agent to work on an issue
crewdeck route-review <issue_id> <agent_id>    — route an issue to a reviewer
crewdeck activity <issue_id>      — fetch comments and activity for an issue
crewdeck history save --summary "..."  — save a decision summary
crewdeck history list             — list your decision history
\`\`\`

## How It Works

1. Events will be sent to you as messages describing what happened (new issue, agent finished, review completed, etc.)
2. Use the CLI commands above to inspect state, assign work, and route reviews.
3. After each decision, save a summary with \`crewdeck history save --summary "..."\`
4. You stay alive across multiple issues — no need to rush.

## Rules

- Max ${maxConcurrency} issue${maxConcurrency === 1 ? "" : "s"} in progress at a time.
- Only assign idle agents to open/draft issues.
- After an agent finishes, route to a reviewer.
- After review approval, the issue is done.
- If a review requests changes, re-assign the original worker.

Start by listing issues and agents to understand the current state.`;

  const history = listCaptainHistory(projectId);
  if (history.length > 0) {
    const entries = history.map((h) => `- [${h.created_at}] ${h.summary}`).join("\n");
    prompt += `\n\n## Decision History (from previous sessions)\n${entries}`;
  }

  return prompt;
}

// Execute an assign action triggered by the captain via CLI
async function executeAssign(
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

// Execute a route-review action triggered by the captain via CLI
async function executeRouteReview(
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

export class OrchestratorManager {
  private readonly captainSessions = new Map<string, string>(); // projectId → sessionId
  private readonly captainSpawning = new Map<string, Promise<string | null>>(); // in-flight spawn guards

  constructor(
    private readonly bus: EventBus,
    private readonly adapter: AgentAdapter,
  ) {}

  init(): void {
    // Captain action events — triggered by captain CLI commands via internal API
    this.bus.on("captain.assign", ({ project_id, issue_id, agent_id }) => {
      void executeAssign(project_id, issue_id, agent_id, this.bus, this.adapter);
    });

    this.bus.on("captain.route_review", ({ project_id, issue_id, reviewer_agent_id }) => {
      void executeRouteReview(project_id, issue_id, reviewer_agent_id, this.bus, this.adapter);
    });

    // Events that get relayed to the captain via tmux send-keys
    this.bus.on("issue.created", ({ issue }) => {
      if (issue.created_by === "orchestrator") return;
      void this.sendToCaptain(
        issue.project_id,
        `A new issue was created: "${escapeXml(issue.title)}" (ID: ${issue.id}, status: ${issue.status}). Use \`crewdeck issues list\` to see details and decide what to do.`,
      );
    });

    this.bus.on("agent.finished", ({ issue_id, project_id, agent_id, role }) => {
      const issue = getIssue(issue_id);
      const agent = getAgent(agent_id);
      void this.sendToCaptain(
        project_id,
        `Agent ${agent?.name ?? agent_id} finished ${role} work on issue "${escapeXml(issue?.title ?? issue_id)}" (issue_id: ${issue_id}). Use \`crewdeck activity ${issue_id}\` to review and decide next steps.`,
      );
    });

    this.bus.on("review.completed", ({ issue_id, project_id, agent_id, verdict }) => {
      this.handleReviewVerdict(issue_id, project_id, agent_id, verdict);

      const safeVerdict = ["approved", "changes_requested"].includes(verdict) ? verdict : "unknown";
      const issue = getIssue(issue_id);
      const agent = getAgent(agent_id);
      void this.sendToCaptain(
        project_id,
        `Review completed on issue "${escapeXml(issue?.title ?? issue_id)}" by ${agent?.name ?? agent_id} with verdict: ${safeVerdict} (round ${issue?.current_review_round ?? "?"}/${issue?.max_review_rounds ?? "?"}).`,
      );
    });

    this.bus.on("comment.added", ({ comment, project_id }) => {
      if (comment.author_type !== "user") return;
      void this.sendToCaptain(
        project_id,
        `User posted a comment on issue ${comment.issue_id}: "${escapeXml(comment.content.slice(0, 200))}"`,
      );
    });

    this.bus.on("captain.message", ({ message, project_id }) => {
      if (message.author_type !== "user") return;
      void this.sendToCaptain(
        project_id,
        `User message: ${escapeXml(message.content.slice(0, 500))}`,
      );
    });
  }

  async ensureCaptainSession(projectId: string): Promise<string | null> {
    const existingSessionId = this.captainSessions.get(projectId);
    if (existingSessionId) {
      const tmuxName = captainSessionName(projectId);
      if (await this.adapter.isAlive(tmuxName)) {
        return tmuxName;
      }
      // Session died — clean up and respawn
      this.captainSessions.delete(projectId);
      updateSession(existingSessionId, { status: "completed" });
    }

    // If another call is already spawning, wait for it
    const inflight = this.captainSpawning.get(projectId);
    if (inflight) return inflight;

    const promise = this.spawnCaptainSession(projectId);
    this.captainSpawning.set(projectId, promise);
    try {
      return await promise;
    } finally {
      this.captainSpawning.delete(projectId);
    }
  }

  private async spawnCaptainSession(projectId: string): Promise<string | null> {
    const project = getProject(projectId);
    if (!project) return null;

    const crew = getCrewWithAgents(projectId);
    if (!crew) return null;

    const captain = getCaptain(crew.id);
    if (!captain) {
      logger.info({ projectId }, "Captain: no captain agent designated, skipping");
      return null;
    }

    const tmuxName = captainSessionName(projectId);
    const initialPrompt = buildCaptainInitialPrompt(projectId, project.max_concurrency);

    const session = createSession({
      project_id: projectId,
      session_type: "captain",
      agent_id: captain.id,
      tmux_session_name: tmuxName,
      status: "running",
      context: {},
    });

    const apiUrl = `http://${config.host}:${config.port}/api/v1`;

    try {
      await this.adapter.spawn({
        sessionName: tmuxName,
        workdir: "/tmp",
        prompt: initialPrompt,
        systemPrompt: captain.system_prompt,
        env: {
          CREWDECK_PROJECT_ID: projectId,
          CREWDECK_AGENT_ID: captain.id,
          CREWDECK_SESSION_ID: session.id,
          CREWDECK_API_URL: apiUrl,
        },
      });
    } catch (err) {
      logger.error({ err, projectId }, "Captain: failed to spawn session");
      updateSession(session.id, { status: "error" });
      return null;
    }

    this.captainSessions.set(projectId, session.id);
    updateProject(projectId, { orchestrator_session_id: session.id });

    this.bus.emit("session.started", {
      session_id: session.id,
      agent_id: captain.id,
      project_id: projectId,
      tmux_session_name: tmuxName,
    });

    logger.info({ projectId, tmuxName }, "Captain session spawned");
    return tmuxName;
  }

  private async sendToCaptain(projectId: string, message: string): Promise<void> {
    const tmuxName = await this.ensureCaptainSession(projectId);
    if (!tmuxName) return;

    try {
      await this.adapter.send(tmuxName, message);
      logger.debug({ projectId, message: message.slice(0, 100) }, "Sent message to captain");
    } catch (err) {
      logger.error({ err, projectId }, "Failed to send message to captain");
      const sessionId = this.captainSessions.get(projectId);
      this.captainSessions.delete(projectId);
      if (sessionId) updateSession(sessionId, { status: "error" });
    }
  }

  private handleReviewVerdict(
    issue_id: string,
    project_id: string,
    agent_id: string,
    verdict: string,
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
        this.bus.emit("issue.status_changed", {
          issue_id,
          project_id,
          from: "in_review",
          to: "ready",
        });
        this.bus.emit("issue.approved", { issue });
      }
    } else if (verdict === "changes_requested") {
      updateIssueAgent(reviewerRecord.id, { status: "changes_requested" });
      const prevIssue = getIssue(issue_id);
      updateIssue(issue_id, { status: "feedback" });
      this.bus.emit("issue.status_changed", {
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

  async killCaptainSession(projectId: string): Promise<void> {
    const tmuxName = captainSessionName(projectId);
    try {
      await this.adapter.kill(tmuxName);
    } catch { /* already gone */ }
    const sessionId = this.captainSessions.get(projectId);
    if (sessionId) {
      updateSession(sessionId, { status: "completed" });
      this.captainSessions.delete(projectId);
    }
  }
}

export function initOrchestrator(adapter: AgentAdapter): OrchestratorManager {
  const manager = new OrchestratorManager(eventBus, adapter);
  manager.init();
  return manager;
}
