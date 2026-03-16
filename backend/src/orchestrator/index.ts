import { logger } from "../logger.js";
import { eventBus } from "../events/bus.js";
import type { EventBus } from "../events/bus.js";
import type { AgentAdapter } from "../agent/types.js";
import { agentSessionName, orchestratorSessionName, mergeContext } from "../agent/types.js";
import { buildAgentPrompt, buildReviewerPrompt } from "../agent/prompt.js";
import { createWorktree, cleanupWorktree } from "../agent/worktree.js";
import { buildOrchestratorPrompt, type OrchestratorState } from "./prompt.js";
import { escapeXml } from "../utils/xml.js";
import { parseAction, validateActionParams, type OrchestratorAction } from "./actions.js";
import { getProject, updateProject } from "../db/repositories/projects.js";
import { listIssues, getIssue, createIssue, updateIssue } from "../db/repositories/issues.js";
import { getAgent } from "../db/repositories/agents.js";
import { getCrewWithAgents } from "../db/repositories/crews.js";
import { listRepos } from "../db/repositories/repos.js";
import { getGitHubAccount } from "../db/repositories/github-accounts.js";
import { createComment, listComments } from "../db/repositories/comments.js";
import {
  listIssueAgents,
  listActiveReviewerAgentIds,
  createIssueAgent,
  updateIssueAgent,
} from "../db/repositories/issue-agents.js";
import {
  createSession,
  getSession,
  updateSession,
} from "../db/repositories/sessions.js";

import { callClaude } from "../utils/claude.js";

function buildState(projectId: string): OrchestratorState | null {
  const project = getProject(projectId);
  if (!project) return null;

  const crew = getCrewWithAgents(projectId);
  if (!crew) return null;

  const all = listIssues(projectId);
  const inReviewIssues = all.filter((i) => i.status === "in_review");

  // Collect agent IDs that are actively reviewing so they aren't shown as idle
  const activeReviewerAgentIds = new Set(
    listActiveReviewerAgentIds(inReviewIssues.map((i) => i.id))
  );

  return {
    project,
    crew,
    openIssues: all.filter((i) => i.status === "open"),
    inProgressIssues: all.filter((i) => i.status === "in_progress"),
    inReviewIssues,
    feedbackIssues: all.filter((i) => i.status === "feedback"),
    draftIssues: all.filter((i) => i.status === "draft"),
    activeReviewerAgentIds,
  };
}

async function executeAssign(
  params: Record<string, unknown>,
  state: OrchestratorState,
  bus: EventBus,
  adapter: AgentAdapter
): Promise<void> {
  const { issue_id, agent_id } = params as { issue_id: string; agent_id: string };
  const projectId = state.project.id;

  const issue = getIssue(issue_id);
  if (!issue) { logger.warn({ issue_id }, "assign: issue not found"); return; }
  if (issue.project_id !== projectId) {
    logger.warn({ issue_id, projectId }, "assign: issue does not belong to project");
    return;
  }
  if (!["open", "draft"].includes(issue.status)) {
    logger.warn({ issue_id, status: issue.status }, "assign: issue is not in assignable state");
    return;
  }

  const agent = getAgent(agent_id);
  if (!agent) { logger.warn({ agent_id }, "assign: agent not found"); return; }
  if (agent.crew_id !== state.crew.id) {
    logger.warn({ agent_id, crew_id: state.crew.id }, "assign: agent does not belong to project crew");
    return;
  }

  // Concurrency check — use pre-built state counts to avoid a second listIssues query
  const activeCount = state.inProgressIssues.length + state.inReviewIssues.length + state.feedbackIssues.length;
  if (activeCount >= state.project.max_concurrency) {
    logger.info({ projectId, activeCount, max: state.project.max_concurrency }, "assign: concurrency limit reached");
    createComment(issue_id, {
      content: `Issue queued — concurrency limit reached (${activeCount}/${state.project.max_concurrency})`,
      author_type: "orchestrator",
    });
    return;
  }

  const updatedIssue = updateIssue(issue_id, { assigned_agent_id: agent_id, status: "in_progress" });

  const issueAgent = createIssueAgent({ issue_id, agent_id, role: "worker", status: "active", review_round: 0 });

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
      logger.error({ err, issue_id }, "assign: failed to create worktree, using /tmp");
      repo = null;
    }
  }

  const promptText = buildAgentPrompt(updatedIssue, agent, repo, {
    worktreePath,
    previousComments: repo ? listComments(issue_id) : undefined,
  });

  // Create session record
  const sessionName = agentSessionName(issue_id, agent_id, "worker");
  const session = createSession({
    project_id: projectId,
    session_type: "worker",
    agent_id,
    issue_id,
    tmux_session_name: sessionName,
    status: "running",
    context: {},
  });

  // Update IssueAgent with session_id
  updateIssueAgent(issueAgent.id, { session_id: session.id });

  // Spawn agent session
  const ghAccount = state.project.github_account_id
    ? getGitHubAccount(state.project.github_account_id)
    : null;

  try {
    await adapter.spawn({
      sessionName,
      workdir: worktreePath,
      prompt: promptText,
      systemPrompt: agent.system_prompt,
      env: {
        CREWDECK_SESSION_ID: session.id,
        CREWDECK_AGENT_ID: agent_id,
        CREWDECK_ISSUE_ID: issue_id,
        CREWDECK_PROJECT_ID: projectId,
        ...(ghAccount ? { GH_TOKEN: ghAccount.oauth_token } : {}),
      },
    });
  } catch (err) {
    logger.error({ err, sessionName }, "assign: failed to spawn agent session");
    updateSession(session.id, { status: "error" });
    updateIssueAgent(issueAgent.id, { status: "error" });
    // Restore all issue fields including worktree fields so the next assignment isn't blocked
    updateIssue(issue_id, {
      status: issue.status,
      assigned_agent_id: issue.assigned_agent_id,
      worktree_path: issue.worktree_path ?? null,
      branch_name: issue.branch_name ?? null,
      base_branch: issue.base_branch ?? null,
    });
    // Clean up the orphaned git worktree so future assignments don't fail on a duplicate branch
    if (repo && createdBranchName) {
      cleanupWorktree(repo, worktreePath, createdBranchName).catch((cleanErr) => {
        logger.warn({ cleanErr, worktreePath }, "assign: failed to clean up orphaned worktree");
      });
    }
    return;
  }

  // Emit events
  bus.emit("issue.status_changed", { issue_id, project_id: projectId, from: issue.status, to: "in_progress" });
  bus.emit("issue.assigned", { issue_id, project_id: projectId, agent_id, agent_name: agent.name });
  bus.emit("session.started", {
    session_id: session.id,
    agent_id,
    issue_id,
    project_id: projectId,
    tmux_session_name: sessionName,
  });

  // Post orchestrator comment
  const comment = createComment(issue_id, {
    content: `Assigned to ${agent.name} (${agent.title}). Session started.`,
    author_type: "orchestrator",
  });
  bus.emit("comment.added", { comment, project_id: projectId });
}

async function executeRouteReview(
  params: Record<string, unknown>,
  state: OrchestratorState,
  bus: EventBus,
  adapter: AgentAdapter
): Promise<void> {
  const { issue_id, reviewer_agent_id, review_order } = params as {
    issue_id: string;
    reviewer_agent_id: string;
    review_order: number;
  };
  const projectId = state.project.id;

  const issue = getIssue(issue_id);
  if (!issue) { logger.warn({ issue_id }, "route_review: issue not found"); return; }
  if (issue.project_id !== projectId) {
    logger.warn({ issue_id, projectId }, "route_review: issue does not belong to project");
    return;
  }
  if (!["in_progress", "feedback"].includes(issue.status)) {
    logger.warn({ issue_id, status: issue.status }, "route_review: issue is not in a reviewable state");
    return;
  }

  const reviewer = getAgent(reviewer_agent_id);
  if (!reviewer) { logger.warn({ reviewer_agent_id }, "route_review: reviewer not found"); return; }
  if (reviewer.crew_id !== state.crew.id) {
    logger.warn({ reviewer_agent_id, crew_id: state.crew.id }, "route_review: reviewer does not belong to project crew");
    return;
  }
  // Update issue to in_review — only increment round when starting a new review cycle
  // (transitioning from in_progress/feedback), not when adding another reviewer to the same cycle.
  const newRound = issue.status !== "in_review"
    ? (issue.current_review_round ?? 0) + 1
    : issue.current_review_round ?? 1;
  const updatedIssue = updateIssue(issue_id, {
    status: "in_review",
    current_review_round: newRound,
  });

  const issueAgent = createIssueAgent({
    issue_id,
    agent_id: reviewer_agent_id,
    role: "reviewer",
    status: "active",
    review_order,
    review_round: newRound,
  });

  const repos = listRepos(projectId);
  const repo = repos.length > 0 ? repos[0] : null;
  const worktreePath = updatedIssue.worktree_path ?? "/tmp";
  const promptText = buildReviewerPrompt(updatedIssue, reviewer, repo, {
    worktreePath,
    branchName: updatedIssue.branch_name ?? "main",
    comments: repo ? listComments(issue_id) : undefined,
  });

  const sessionName = agentSessionName(issue_id, reviewer_agent_id, "reviewer");
  const session = createSession({
    project_id: projectId,
    session_type: "reviewer",
    agent_id: reviewer_agent_id,
    issue_id,
    tmux_session_name: sessionName,
    status: "running",
    context: {},
  });

  updateIssueAgent(issueAgent.id, { session_id: session.id });

  const ghAccount = state.project.github_account_id
    ? getGitHubAccount(state.project.github_account_id)
    : null;

  try {
    await adapter.spawn({
      sessionName,
      workdir: worktreePath,
      prompt: promptText,
      systemPrompt: reviewer.system_prompt,
      env: {
        CREWDECK_SESSION_ID: session.id,
        CREWDECK_AGENT_ID: reviewer_agent_id,
        CREWDECK_ISSUE_ID: issue_id,
        CREWDECK_PROJECT_ID: projectId,
        ...(ghAccount ? { GH_TOKEN: ghAccount.oauth_token } : {}),
      },
    });
  } catch (err) {
    logger.error({ err, sessionName }, "route_review: failed to spawn reviewer session");
    updateSession(session.id, { status: "error" });
    updateIssueAgent(issueAgent.id, { status: "error" });
    updateIssue(issue_id, { status: issue.status, current_review_round: issue.current_review_round ?? null });
    return;
  }

  bus.emit("issue.status_changed", { issue_id, project_id: projectId, from: issue.status, to: "in_review" });
  bus.emit("issue.assigned", {
    issue_id,
    project_id: projectId,
    agent_id: reviewer_agent_id,
    agent_name: reviewer.name,
  });
  bus.emit("session.started", {
    session_id: session.id,
    agent_id: reviewer_agent_id,
    issue_id,
    project_id: projectId,
    tmux_session_name: sessionName,
  });

  const comment = createComment(issue_id, {
    content: `Routing to ${reviewer.name} for code review (round ${updatedIssue.current_review_round}).`,
    author_type: "orchestrator",
  });
  bus.emit("comment.added", { comment, project_id: projectId });
}

function executeEscalate(params: Record<string, unknown>, projectId: string, bus: EventBus): void {
  const { issue_id, reason } = params as { issue_id: string; reason: string };
  const issue = getIssue(issue_id);
  if (!issue) { logger.warn({ issue_id }, "escalate: issue not found"); return; }
  if (issue.project_id !== projectId) {
    logger.warn({ issue_id, projectId }, "escalate: issue does not belong to project");
    return;
  }

  const comment = createComment(issue_id, {
    content: `⚠️ Escalated to human attention: ${reason}`,
    author_type: "orchestrator",
  });
  bus.emit("comment.added", { comment, project_id: projectId });
}

function executeCreateDraftIssue(
  params: Record<string, unknown>,
  projectId: string,
  bus: EventBus
): void {
  const { title, description, priority } = params as {
    title: string;
    description: string;
    priority?: number;
  };

  const draftIssue = createIssue(projectId, {
    title,
    description,
    status: "draft",
    priority: typeof priority === "number" ? priority : 0,
    created_by: "orchestrator",
  });

  bus.emit("orchestrator.draft_issue", { issue: draftIssue, project_id: projectId });
  bus.emit("issue.created", { issue: draftIssue });
}

function executeReorder(params: Record<string, unknown>, projectId: string): void {
  const { issue_priorities } = params as {
    issue_priorities: Array<{ issue_id: string; priority: number }>;
  };
  for (const { issue_id, priority } of issue_priorities) {
    const issue = getIssue(issue_id);
    if (!issue || issue.project_id !== projectId) continue;
    updateIssue(issue_id, { priority });
  }
}

async function executeAction(
  action: OrchestratorAction,
  state: OrchestratorState,
  bus: EventBus,
  adapter: AgentAdapter
): Promise<void> {
  const { params } = action;
  const projectId = state.project.id;

  switch (action.action) {
    case "assign":
      await executeAssign(params, state, bus, adapter);
      break;
    case "route_review":
      await executeRouteReview(params, state, bus, adapter);
      break;
    case "escalate":
      executeEscalate(params, projectId, bus);
      break;
    case "create_draft_issue":
      executeCreateDraftIssue(params, projectId, bus);
      break;
    case "reorder":
      executeReorder(params, projectId);
      break;
    case "no_action":
      logger.info({ projectId, reasoning: action.reasoning }, "Orchestrator: no_action");
      break;
  }
}

function persistContext(sessionId: string, action: OrchestratorAction): void {
  const session = getSession(sessionId);
  if (!session) return;

  updateSession(sessionId, {
    context: mergeContext(session.context, {
      last_action: action.action,
      last_reasoning: action.reasoning,
      last_run: new Date().toISOString(),
    }),
  });
}

export class OrchestratorManager {
  // Track projects currently being processed to avoid concurrent runs
  private readonly busy = new Set<string>();
  // Track projects that received events while busy — triggers a re-run after the current one
  private readonly pendingRerun = new Set<string>();

  constructor(
    private readonly bus: EventBus,
    private readonly adapter: AgentAdapter,
    // Injected for testability — defaults to the module-level callClaude
    private readonly claudeFn: (prompt: string) => Promise<string> = callClaude
  ) {}

  init(): void {
    // NOTE: User-controlled strings (issue titles, comments) are wrapped in XML tags
    // to clearly delimit data from instructions and mitigate prompt injection.

    this.bus.on("issue.created", ({ issue }) => {
      if (issue.created_by === "orchestrator") return;
      void this.resume(
        issue.project_id,
        `A new issue was created (ID: ${issue.id}, status: ${issue.status}):\n<issue_title>${escapeXml(issue.title)}</issue_title>`
      );
    });

    // issue.approved is handled inside the review.completed handler below — no separate
    // orchestrator resume needed since handleReviewVerdict runs synchronously first and
    // review.completed already carries the full verdict context.

    this.bus.on("agent.finished", ({ issue_id, project_id, agent_id, role }) => {
      const issue = getIssue(issue_id);
      void this.resume(
        project_id,
        `Agent finished work on issue (issue_id: ${escapeXml(issue_id)}, agent_id: ${escapeXml(agent_id)}, role: ${escapeXml(role)}):\n<issue_title>${escapeXml(issue?.title ?? issue_id)}</issue_title>\nThe work session has ended — consider routing to review if work is complete.`
      );
    });

    this.bus.on("review.completed", ({ issue_id, project_id, agent_id, verdict }) => {
      // Update IssueAgent status and issue status synchronously before resuming so the
      // orchestrator sees the updated state (e.g. issue.status === "ready" on full approval).
      this.handleReviewVerdict(issue_id, project_id, agent_id, verdict);

      // Validate verdict against the known allowlist before embedding in prompt
      const safeVerdict = ["approved", "changes_requested"].includes(verdict) ? verdict : "unknown";
      const issue = getIssue(issue_id);
      void this.resume(
        project_id,
        `Review completed (issue_id: ${escapeXml(issue_id)}, reviewer_agent_id: ${escapeXml(agent_id)}, verdict: ${safeVerdict}, round: ${issue?.current_review_round ?? "?"}/${issue?.max_review_rounds ?? "?"}):\n<issue_title>${escapeXml(issue?.title ?? issue_id)}</issue_title>`
      );
    });

    this.bus.on("comment.added", ({ comment, project_id }) => {
      // Only re-evaluate on user comments, not orchestrator/agent comments
      if (comment.author_type !== "user") return;
      void this.resume(
        project_id,
        `A user posted a comment on issue ${comment.issue_id}:\n<user_comment>${escapeXml(comment.content.slice(0, 200))}</user_comment>`
      );
    });
  }

  private handleReviewVerdict(
    issue_id: string,
    project_id: string,
    agent_id: string,
    verdict: string
  ): void {
    // Find the active reviewer IssueAgent record
    const agents = listIssueAgents(issue_id);
    const reviewerRecord = agents
      .filter((ia) => ia.agent_id === agent_id && ia.role === "reviewer" && ia.status === "active")
      .at(-1);

    if (!reviewerRecord) return;

    if (verdict === "approved") {
      updateIssueAgent(reviewerRecord.id, { status: "approved" });

      // Re-fetch after DB update to avoid fragile in-memory mutation.
      // Filter by review_round so stale records from crashed prior rounds are excluded.
      const freshIssue = getIssue(issue_id);
      const currentRound = freshIssue?.current_review_round ?? null;
      const freshAgents = listIssueAgents(issue_id);
      const allForRound = freshAgents.filter(
        (ia) => ia.role === "reviewer" && ia.review_round === currentRound
      );
      const allApproved = allForRound.every((ia) => ia.status === "approved");
      // Only transition to "ready" if the issue is currently "in_review" — if another reviewer
      // in this round already requested changes the status is "feedback" and we must not override it.
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
      // Unknown verdict — mark the IssueAgent as error so the review cycle isn't permanently stuck
      logger.warn({ issue_id, agent_id, verdict }, "handleReviewVerdict: unknown verdict");
      updateIssueAgent(reviewerRecord.id, { status: "error" });
    }
  }

  private async resume(projectId: string, eventDescription: string): Promise<void> {
    if (this.busy.has(projectId)) {
      logger.info({ projectId }, "Orchestrator busy for project, queuing re-run");
      this.pendingRerun.add(projectId);
      return;
    }
    this.busy.add(projectId);
    try {
      await this.run(projectId, eventDescription);
    } catch (err) {
      logger.error({ err, projectId }, "Orchestrator run failed");
    } finally {
      this.busy.delete(projectId);
      if (this.pendingRerun.delete(projectId)) {
        void this.resume(projectId, "Re-evaluating after events were received during previous run");
      }
    }
  }

  private async run(projectId: string, eventDescription: string): Promise<void> {
    const state = buildState(projectId);
    if (!state) {
      logger.warn({ projectId }, "Orchestrator: project or crew not found");
      return;
    }

    // Ensure an orchestrator session record exists; track the ID to avoid re-fetching project later
    const project = state.project;
    let orchestratorSessionId = project.orchestrator_session_id;
    if (!orchestratorSessionId) {
      const session = createSession({
        project_id: projectId,
        session_type: "orchestrator",
        status: "running",
        context: {},
        tmux_session_name: orchestratorSessionName(projectId),
      });
      updateProject(projectId, { orchestrator_session_id: session.id });
      orchestratorSessionId = session.id;
    }

    const prompt = buildOrchestratorPrompt(state, eventDescription);
    logger.debug({ projectId, eventDescription }, "Orchestrator resuming");

    let output: string;
    try {
      output = await this.claudeFn(prompt);
    } catch (err) {
      logger.error({ err, projectId }, "Orchestrator: Claude call failed");
      return;
    }

    const action = parseAction(output);
    if (!action) {
      logger.warn({ projectId, output: output.slice(0, 500) }, "Orchestrator: invalid JSON from Claude");
      return;
    }

    const paramError = validateActionParams(action);
    if (paramError) {
      logger.warn({ projectId, paramError, action: action.action }, "Orchestrator: invalid action params");
      return;
    }

    logger.info({ projectId, action: action.action, reasoning: action.reasoning }, "Orchestrator decision");

    this.bus.emit("orchestrator.decision", {
      project_id: projectId,
      action: action.action,
      details: action.params,
    });

    await executeAction(action, state, this.bus, this.adapter);

    persistContext(orchestratorSessionId, action);
  }
}

export function initOrchestrator(adapter: AgentAdapter): OrchestratorManager {
  const manager = new OrchestratorManager(eventBus, adapter);
  manager.init();
  return manager;
}
