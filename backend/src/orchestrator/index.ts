import { exec } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../logger.js";
import { eventBus } from "../events/bus.js";
import type { EventBus } from "../events/bus.js";
import type { AgentAdapter } from "../agent/types.js";
import { agentSessionName, orchestratorSessionName, mergeContext } from "../agent/types.js";
import { buildAgentPrompt, buildReviewerPrompt } from "../agent/prompt.js";
import { createWorktree } from "../agent/worktree.js";
import { buildOrchestratorPrompt, type OrchestratorState } from "./prompt.js";
import { parseAction, validateActionParams, type OrchestratorAction } from "./actions.js";
import { getProject, updateProject } from "../db/repositories/projects.js";
import { listIssues, getIssue, createIssue, updateIssue } from "../db/repositories/issues.js";
import { getAgent } from "../db/repositories/agents.js";
import { getCrewWithAgents } from "../db/repositories/crews.js";
import { listRepos } from "../db/repositories/repos.js";
import { createComment, listComments } from "../db/repositories/comments.js";
import {
  listIssueAgents,
  createIssueAgent,
  updateIssueAgent,
} from "../db/repositories/issue-agents.js";
import {
  createSession,
  getSession,
  updateSession,
} from "../db/repositories/sessions.js";

const execAsync = promisify(exec);

// Run claude in --print mode and return stdout.
// Base64-encode the prompt so it's safe to embed in the bash command (base64 only uses [A-Za-z0-9+/=]).
export async function callClaude(prompt: string): Promise<string> {
  const encoded = Buffer.from(prompt).toString("base64");
  // base64 output is safe to embed unquoted inside single-quoted strings — no shell metacharacters
  const cmd = `bash -c 'PROMPT=$(printf "%s" ${encoded} | base64 -d); claude --dangerously-skip-permissions --print --prompt "$PROMPT"'`;
  const { stdout } = await execAsync(cmd, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

function buildState(projectId: string): OrchestratorState | null {
  const project = getProject(projectId);
  if (!project) return null;

  const crew = getCrewWithAgents(projectId);
  if (!crew) return null;

  const all = listIssues(projectId);
  return {
    project,
    crew,
    openIssues: all.filter((i) => i.status === "open"),
    inProgressIssues: all.filter((i) => i.status === "in_progress"),
    inReviewIssues: all.filter((i) => i.status === "in_review"),
    feedbackIssues: all.filter((i) => i.status === "feedback"),
    draftIssues: all.filter((i) => i.status === "draft"),
  };
}

async function executeAssign(
  params: Record<string, unknown>,
  projectId: string,
  bus: EventBus,
  adapter: AgentAdapter
): Promise<void> {
  const { issue_id, agent_id } = params as { issue_id: string; agent_id: string };

  const issue = getIssue(issue_id);
  if (!issue) { logger.warn({ issue_id }, "assign: issue not found"); return; }
  if (!["open", "draft"].includes(issue.status)) {
    logger.warn({ issue_id, status: issue.status }, "assign: issue is not in assignable state");
    return;
  }

  const agent = getAgent(agent_id);
  if (!agent) { logger.warn({ agent_id }, "assign: agent not found"); return; }

  // Concurrency check
  const project = getProject(projectId)!;
  const activeCount = listIssues(projectId).filter((i) =>
    ["in_progress", "in_review", "feedback"].includes(i.status)
  ).length;
  if (activeCount >= project.max_concurrency) {
    logger.info({ projectId, activeCount, max: project.max_concurrency }, "assign: concurrency limit reached");
    createComment(issue_id, {
      content: `Issue queued — concurrency limit reached (${activeCount}/${project.max_concurrency})`,
      author_type: "orchestrator",
    });
    return;
  }

  const updatedIssue = updateIssue(issue_id, { assigned_agent_id: agent_id, status: "in_progress" });

  const issueAgent = createIssueAgent({ issue_id, agent_id, role: "worker", status: "active" });

  // Create worktree if repo is configured
  const repos = listRepos(projectId);
  let worktreePath = "/tmp";
  if (repos.length > 0) {
    const repo = repos[0];
    try {
      worktreePath = await createWorktree(repo, updatedIssue, repo.default_branch);
    } catch (err) {
      logger.error({ err, issue_id }, "assign: failed to create worktree, using /tmp");
    }
  }

  // Build agent prompt
  const comments = listComments(issue_id);
  const promptText = repos.length > 0
    ? buildAgentPrompt(updatedIssue, agent, repos[0], { worktreePath, previousComments: comments })
    : `You are ${agent.name}. Work on: ${issue.title}\n\n${issue.description}\n\nRun: crewdeck signal --event work-complete when done.`;

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
      },
    });
  } catch (err) {
    logger.error({ err, sessionName }, "assign: failed to spawn agent session");
    updateSession(session.id, { status: "error" });
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
    content: `Assigned to ${agent.name} (${agent.role}). Session started.`,
    author_type: "orchestrator",
  });
  bus.emit("comment.added", { comment, project_id: projectId });
}

async function executeRouteReview(
  params: Record<string, unknown>,
  projectId: string,
  bus: EventBus,
  adapter: AgentAdapter
): Promise<void> {
  const { issue_id, reviewer_agent_id, review_order } = params as {
    issue_id: string;
    reviewer_agent_id: string;
    review_order: number;
  };

  const issue = getIssue(issue_id);
  if (!issue) { logger.warn({ issue_id }, "route_review: issue not found"); return; }

  const reviewer = getAgent(reviewer_agent_id);
  if (!reviewer) { logger.warn({ reviewer_agent_id }, "route_review: reviewer not found"); return; }
  if (!reviewer.can_review) {
    logger.warn({ reviewer_agent_id }, "route_review: agent cannot review");
    return;
  }

  // Update issue to in_review and increment round
  const updatedIssue = updateIssue(issue_id, {
    status: "in_review",
    current_review_round: (issue.current_review_round ?? 0) + 1,
  });

  const issueAgent = createIssueAgent({
    issue_id,
    agent_id: reviewer_agent_id,
    role: "reviewer",
    status: "active",
    review_order,
  });

  // Build reviewer prompt
  const repos = listRepos(projectId);
  const comments = listComments(issue_id);
  const worktreePath = updatedIssue.worktree_path ?? "/tmp";
  const promptText = repos.length > 0
    ? buildReviewerPrompt(updatedIssue, reviewer, repos[0], {
        worktreePath,
        branchName: updatedIssue.branch_name ?? "main",
        comments,
      })
    : `You are ${reviewer.name}, a reviewer. Review the code for: ${issue.title}\n\nRun crewdeck signal --event review-complete --data '{"verdict":"approved"}' or '{"verdict":"changes_requested"}' when done.`;

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
      },
    });
  } catch (err) {
    logger.error({ err, sessionName }, "route_review: failed to spawn reviewer session");
    updateSession(session.id, { status: "error" });
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

  const issue = createIssue(projectId, {
    title,
    description: description ?? "",
    priority: typeof priority === "number" ? priority : 0,
    created_by: "orchestrator",
  });
  // Draft status — override the default "open"
  updateIssue(issue.id, { status: "draft" });
  const draftIssue = getIssue(issue.id)!;

  bus.emit("orchestrator.draft_issue", { issue: draftIssue, project_id: projectId });
  bus.emit("issue.created", { issue: draftIssue });
}

function executeReorder(params: Record<string, unknown>): void {
  const { issue_priorities } = params as {
    issue_priorities: Array<{ issue_id: string; priority: number }>;
  };
  for (const { issue_id, priority } of issue_priorities) {
    const issue = getIssue(issue_id);
    if (issue) updateIssue(issue_id, { priority });
  }
}

async function executeAction(
  action: OrchestratorAction,
  projectId: string,
  bus: EventBus,
  adapter: AgentAdapter
): Promise<void> {
  const { params } = action;

  switch (action.action) {
    case "assign":
      await executeAssign(params, projectId, bus, adapter);
      break;
    case "route_review":
      await executeRouteReview(params, projectId, bus, adapter);
      break;
    case "escalate":
      executeEscalate(params, projectId, bus);
      break;
    case "create_draft_issue":
      executeCreateDraftIssue(params, projectId, bus);
      break;
    case "reorder":
      executeReorder(params);
      break;
    case "no_action":
      logger.info({ projectId, reasoning: action.reasoning }, "Orchestrator: no_action");
      break;
  }
}

function persistContext(project_id: string, action: OrchestratorAction): void {
  const project = getProject(project_id);
  if (!project?.orchestrator_session_id) return;

  const session = getSession(project.orchestrator_session_id);
  if (!session) return;

  updateSession(session.id, {
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

  constructor(
    private readonly bus: EventBus,
    private readonly adapter: AgentAdapter,
    // Injected for testability — defaults to the module-level callClaude
    private readonly claudeFn: (prompt: string) => Promise<string> = callClaude
  ) {}

  init(): void {
    this.bus.on("issue.created", ({ issue }) => {
      void this.resume(
        issue.project_id,
        `A new issue was created: "${issue.title}" (ID: ${issue.id}, status: ${issue.status})`
      );
    });

    this.bus.on("issue.approved", ({ issue }) => {
      void this.resume(
        issue.project_id,
        `Issue was approved and is ready for prioritization/assignment: "${issue.title}" (ID: ${issue.id})`
      );
    });

    this.bus.on("agent.finished", ({ issue_id, project_id, agent_id, role }) => {
      const issue = getIssue(issue_id);
      const issueTitle = issue?.title ?? issue_id;
      void this.resume(
        project_id,
        `Agent finished work on issue "${issueTitle}" (issue_id: ${issue_id}, agent_id: ${agent_id}, role: ${role}). The work session has ended — consider routing to review if work is complete.`
      );
    });

    this.bus.on("review.completed", ({ issue_id, project_id, agent_id, verdict }) => {
      // Pre-process: update IssueAgent status based on verdict
      this.handleReviewVerdict(issue_id, project_id, agent_id, verdict);

      const issue = getIssue(issue_id);
      const issueTitle = issue?.title ?? issue_id;
      void this.resume(
        project_id,
        `Review completed for issue "${issueTitle}" (issue_id: ${issue_id}, reviewer_agent_id: ${agent_id}, verdict: ${verdict}). Current review round: ${issue?.current_review_round ?? "?"}/${getProject(project_id)?.max_review_rounds ?? "?"}.`
      );
    });

    this.bus.on("comment.added", ({ comment, project_id }) => {
      // Only re-evaluate on user comments, not orchestrator/agent comments
      if (comment.author_type !== "user") return;
      void this.resume(
        project_id,
        `A user posted a comment on issue ${comment.issue_id}: "${comment.content.slice(0, 200)}"`
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

      // Check if all reviewers for the current round approved.
      // Only consider "active" or "approved" records — prior round records
      // with "changes_requested" status must be excluded.
      const allForRound = listIssueAgents(issue_id).filter(
        (ia) => ia.role === "reviewer" && (ia.status === "active" || ia.status === "approved")
      );
      const allApproved = allForRound.every((ia) => ia.status === "approved");
      if (allApproved && allForRound.length > 0) {
        updateIssue(issue_id, { status: "ready" });
        const issue = getIssue(issue_id)!;
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
      updateIssue(issue_id, { status: "feedback" });
      this.bus.emit("issue.status_changed", {
        issue_id,
        project_id,
        from: "in_review",
        to: "feedback",
      });
    }
  }

  private async resume(projectId: string, eventDescription: string): Promise<void> {
    if (this.busy.has(projectId)) {
      logger.info({ projectId }, "Orchestrator busy for project, skipping event");
      return;
    }
    this.busy.add(projectId);
    try {
      await this.run(projectId, eventDescription);
    } catch (err) {
      logger.error({ err, projectId }, "Orchestrator run failed");
    } finally {
      this.busy.delete(projectId);
    }
  }

  private async run(projectId: string, eventDescription: string): Promise<void> {
    const state = buildState(projectId);
    if (!state) {
      logger.warn({ projectId }, "Orchestrator: project or crew not found");
      return;
    }

    // Ensure an orchestrator session record exists
    const project = state.project;
    if (!project.orchestrator_session_id) {
      const session = createSession({
        project_id: projectId,
        session_type: "orchestrator",
        status: "running",
        context: {},
        tmux_session_name: orchestratorSessionName(projectId),
      });
      updateProject(projectId, { orchestrator_session_id: session.id });
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

    await executeAction(action, projectId, this.bus, this.adapter);

    persistContext(projectId, action);
  }
}

export function initOrchestrator(adapter: AgentAdapter): OrchestratorManager {
  const manager = new OrchestratorManager(eventBus, adapter);
  manager.init();
  return manager;
}
