/**
 * Mention handler with batch tracking for agent spawning.
 *
 * When a comment spawns multiple agents, they are grouped as a batch.
 * The system tracks batch completion and auto-spawns the originator
 * when all batch members finish.
 */

import { extractAgentNames } from "./parser.js";
import { logger } from "../logger.js";
import { eventBus } from "../events/bus.js";
import type { EventBus } from "../events/bus.js";
import type { AgentAdapter } from "../agent/types.js";
import { agentSessionName } from "../agent/types.js";
import { buildAgentPrompt, buildReviewerPrompt } from "../agent/prompt.js";
import { getAgent, listAgents, getCaptain } from "../db/repositories/agents.js";
import { getIssue } from "../db/repositories/issues.js";
import { getProject } from "../db/repositories/projects.js";
import { getCrewWithAgents, getCrew } from "../db/repositories/crews.js";
import { listRepos } from "../db/repositories/repos.js";
import { listComments, createComment } from "../db/repositories/comments.js";
import { createSession, updateSession } from "../db/repositories/sessions.js";
import { db } from "../db/index.js";
import { createIssueAgent, updateIssueAgent } from "../db/repositories/issue-agents.js";
import { getGitHubAccount } from "../db/repositories/github-accounts.js";
import type { Agent, Comment } from "../types/entities.js";

/** Batch tracking for grouped agent spawns */
export interface AgentBatch {
  id: string;
  issueId: string;
  projectId: string;
  originatorAgentId: string;
  memberAgentIds: Set<string>;
  completedAgentIds: Set<string>;
  createdAt: Date;
}

/** Default batch timeout in milliseconds (30 minutes) */
const BATCH_TIMEOUT_MS = 30 * 60 * 1000;
/** Cleanup interval in milliseconds (5 minutes) */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export class MentionHandler {
  /** Active batches by batch ID */
  private batches = new Map<string, AgentBatch>();
  /** Map from issueId to active batch ID for that issue */
  private issueBatches = new Map<string, string>();
  /** Cleanup interval handle */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly bus: EventBus,
    private readonly adapter: AgentAdapter,
  ) {}

  init(): void {
    // Listen for comment.added to handle @mentions
    this.bus.on("comment.added", ({ comment, project_id }) => {
      void this.handleComment(comment, project_id);
    });

    // Listen for agent.finished to track batch completion
    this.bus.on("agent.finished", ({ session_id, agent_id, issue_id, project_id }) => {
      this.markAgentCompleted(agent_id, issue_id, project_id);
    });

    // Start periodic cleanup of stale batches
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleBatches();
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * Stop the handler and clean up resources.
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Handle a new comment and spawn agents for any @mentions.
   */
  async handleComment(comment: Comment, projectId: string): Promise<void> {
    // Only process agent comments for @mentions (user comments go to captain via orchestrator)
    if (comment.author_type !== "agent") return;

    const issue = getIssue(comment.issue_id);
    if (!issue) return;

    const crew = getCrew(projectId);
    if (!crew) return;

    const agents = listAgents(crew.id);
    const agentsByName = new Map(agents.map((a) => [a.name.toLowerCase(), a]));

    // Get the authoring agent (if any)
    const authorAgent = comment.author_id ? getAgent(comment.author_id) : null;
    const selfAgentName = authorAgent?.name;

    // Parse mentions, skipping self-mentions
    const mentionedNames = extractAgentNames(comment.content, selfAgentName);
    if (mentionedNames.length === 0) return;

    // Resolve mentioned names to agents
    const mentionedAgents: Agent[] = [];
    for (const name of mentionedNames) {
      const agent = agentsByName.get(name);
      if (agent) {
        mentionedAgents.push(agent);
      } else {
        logger.debug({ name, issueId: issue.id }, "Mentioned agent not found in crew");
      }
    }

    if (mentionedAgents.length === 0) return;

    // Check if there's a pending batch for this issue with the authoring agent as originator
    // If so, filter out mentions of the batch originator
    const existingBatchId = this.issueBatches.get(issue.id);
    if (existingBatchId) {
      const batch = this.batches.get(existingBatchId);
      if (batch) {
        // Filter out the batch originator from mentions
        const filteredAgents = mentionedAgents.filter(
          (a) => a.id !== batch.originatorAgentId
        );
        if (filteredAgents.length === 0) {
          logger.debug(
            { issueId: issue.id, batchId: existingBatchId },
            "All mentions filtered out (batch originator)"
          );
          return;
        }
        // Spawn filtered agents without creating a new batch
        await this.spawnAgents(filteredAgents, issue.id, projectId, null);
        return;
      }
    }

    // Create a batch if multiple agents are being spawned by an agent author
    let batchId: string | null = null;
    if (mentionedAgents.length > 1 && authorAgent) {
      batchId = this.createBatch(
        issue.id,
        projectId,
        authorAgent.id,
        mentionedAgents.map((a) => a.id)
      );
    }

    // Spawn the mentioned agents
    await this.spawnAgents(mentionedAgents, issue.id, projectId, batchId);
  }

  /**
   * Create a new batch for tracking grouped agent spawns.
   */
  private createBatch(
    issueId: string,
    projectId: string,
    originatorAgentId: string,
    memberAgentIds: string[]
  ): string {
    const batchId = crypto.randomUUID();
    const batch: AgentBatch = {
      id: batchId,
      issueId,
      projectId,
      originatorAgentId,
      memberAgentIds: new Set(memberAgentIds),
      completedAgentIds: new Set(),
      createdAt: new Date(),
    };
    this.batches.set(batchId, batch);
    this.issueBatches.set(issueId, batchId);
    logger.info(
      { batchId, issueId, originatorAgentId, members: memberAgentIds },
      "Created agent batch"
    );
    return batchId;
  }

  /**
   * Spawn agents for the given mentions.
   */
  private async spawnAgents(
    agents: Agent[],
    issueId: string,
    projectId: string,
    batchId: string | null
  ): Promise<void> {
    const issue = getIssue(issueId);
    if (!issue) return;

    const project = getProject(projectId);
    if (!project) return;

    const repos = listRepos(projectId);
    const repo = repos.length > 0 ? repos[0] : null;
    const worktreePath = issue.worktree_path ?? "/tmp";

    const ghAccount = project.github_account_id
      ? getGitHubAccount(project.github_account_id)
      : null;

    for (const agent of agents) {
      // Dedup guard: skip if agent is already running on this issue (query Session table)
      if (this.isAgentRunningOnIssue(issueId, agent.id)) {
        logger.debug(
          { agentId: agent.id, issueId },
          "Skipping spawn: agent already running on issue"
        );
        continue;
      }

      // Check for pending batch with this agent as originator
      const existingBatchId = this.issueBatches.get(issueId);
      if (existingBatchId) {
        const batch = this.batches.get(existingBatchId);
        if (batch && batch.originatorAgentId === agent.id) {
          logger.debug(
            { agentId: agent.id, issueId, batchId: existingBatchId },
            "Skipping spawn: agent is batch originator with pending batch"
          );
          continue;
        }
      }

      await this.spawnAgent(agent, issue, projectId, repo, worktreePath, ghAccount, batchId);
    }
  }

  /**
   * Spawn a single agent.
   */
  private async spawnAgent(
    agent: Agent,
    issue: ReturnType<typeof getIssue>,
    projectId: string,
    repo: ReturnType<typeof listRepos>[0] | null,
    worktreePath: string,
    ghAccount: ReturnType<typeof getGitHubAccount>,
    batchId: string | null
  ): Promise<void> {
    if (!issue) return;

    // Determine role based on agent type
    const role = agent.is_captain ? "captain" : "mention";

    const sessionName = agentSessionName(issue.id, agent.id, role);

    // Build prompt based on role
    const previousComments = repo ? listComments(issue.id) : undefined;
    const promptText = buildAgentPrompt(issue, agent, repo, {
      worktreePath,
      previousComments,
    });

    const session = createSession({
      project_id: projectId,
      session_type: role,
      agent_id: agent.id,
      issue_id: issue.id,
      tmux_session_name: sessionName,
      status: "running",
      context: batchId ? { batch_id: batchId } : {},
    });

    const issueAgent = createIssueAgent({
      issue_id: issue.id,
      agent_id: agent.id,
      role,
      status: "active",
      review_round: issue.current_review_round ?? 0,
    });

    updateIssueAgent(issueAgent.id, { session_id: session.id });

    try {
      await this.adapter.spawn({
        sessionName,
        workdir: worktreePath,
        prompt: promptText,
        systemPrompt: agent.system_prompt,
        env: {
          CREWDECK_SESSION_ID: session.id,
          CREWDECK_AGENT_ID: agent.id,
          CREWDECK_ISSUE_ID: issue.id,
          CREWDECK_PROJECT_ID: projectId,
          ...(ghAccount ? { GH_TOKEN: ghAccount.oauth_token } : {}),
        },
      });

      this.bus.emit("session.started", {
        session_id: session.id,
        agent_id: agent.id,
        issue_id: issue.id,
        project_id: projectId,
        tmux_session_name: sessionName,
      });

      logger.info(
        { agentId: agent.id, agentName: agent.name, issueId: issue.id, batchId },
        "Spawned agent via @mention"
      );
    } catch (err) {
      logger.error({ err, agentId: agent.id, issueId: issue.id }, "Failed to spawn agent");
      updateSession(session.id, { status: "error" });
      updateIssueAgent(issueAgent.id, { status: "error" });
    }
  }

  /**
   * Mark an agent as completed in its batch and check for batch completion.
   */
  private markAgentCompleted(agentId: string, issueId: string, projectId: string): void {
    const batchId = this.issueBatches.get(issueId);
    if (!batchId) return;

    const batch = this.batches.get(batchId);
    if (!batch) return;

    // Only track members of the batch
    if (!batch.memberAgentIds.has(agentId)) return;

    batch.completedAgentIds.add(agentId);
    logger.debug(
      {
        batchId,
        agentId,
        completed: batch.completedAgentIds.size,
        total: batch.memberAgentIds.size,
      },
      "Agent completed in batch"
    );

    // Check if batch is complete
    if (batch.completedAgentIds.size >= batch.memberAgentIds.size) {
      this.handleBatchComplete(batch);
    }
  }

  /**
   * Handle batch completion - auto-spawn the originator agent.
   */
  private handleBatchComplete(batch: AgentBatch): void {
    logger.info(
      { batchId: batch.id, originatorAgentId: batch.originatorAgentId },
      "Batch complete, auto-spawning originator"
    );

    // Clean up batch tracking
    this.batches.delete(batch.id);
    this.issueBatches.delete(batch.issueId);

    // Get the originator agent
    const originator = getAgent(batch.originatorAgentId);
    if (!originator) {
      logger.warn({ agentId: batch.originatorAgentId }, "Batch originator not found");
      return;
    }

    // Create a system comment to trigger the originator
    const comment = createComment(batch.issueId, {
      content: `All batch members have completed. Auto-invoking ${originator.name} for follow-up.`,
      author_type: "orchestrator",
    });

    this.bus.emit("comment.added", { comment, project_id: batch.projectId });

    // Directly spawn the originator (since orchestrator comments won't trigger handleComment)
    const issue = getIssue(batch.issueId);
    if (!issue) return;

    const project = getProject(batch.projectId);
    if (!project) return;

    const repos = listRepos(batch.projectId);
    const repo = repos.length > 0 ? repos[0] : null;
    const worktreePath = issue.worktree_path ?? "/tmp";

    const ghAccount = project.github_account_id
      ? getGitHubAccount(project.github_account_id)
      : null;

    // Dedup check before spawning originator (query Session table)
    if (this.isAgentRunningOnIssue(batch.issueId, originator.id)) {
      logger.debug(
        { agentId: originator.id, issueId: batch.issueId },
        "Skipping originator spawn: already running"
      );
      return;
    }

    void this.spawnAgent(originator, issue, batch.projectId, repo, worktreePath, ghAccount, null);
  }

  /**
   * Check if an agent is the originator of a pending batch on an issue.
   */
  hasPendingBatchForOriginator(issueId: string, agentId: string): boolean {
    const batchId = this.issueBatches.get(issueId);
    if (!batchId) return false;
    const batch = this.batches.get(batchId);
    if (!batch) return false;
    return batch.originatorAgentId === agentId;
  }

  /**
   * Check if an agent is already running on an issue by querying the Session table.
   * This is the single source of truth for active sessions, avoiding state divergence.
   */
  isAgentRunningOnIssue(issueId: string, agentId: string): boolean {
    const row = db.prepare(
      "SELECT 1 FROM Session WHERE issue_id = ? AND agent_id = ? AND status = 'running' LIMIT 1"
    ).get(issueId, agentId);
    return row !== undefined;
  }

  /**
   * Clean up stale batches that have exceeded the timeout.
   * This handles cases where an agent crashes and never finishes.
   */
  private cleanupStaleBatches(): void {
    const now = Date.now();
    const staleBatches: AgentBatch[] = [];

    // Collect stale batches first to avoid mutating during iteration
    for (const batch of this.batches.values()) {
      const age = now - batch.createdAt.getTime();
      if (age > BATCH_TIMEOUT_MS) {
        logger.warn(
          { batchId: batch.id, issueId: batch.issueId, age: Math.round(age / 1000 / 60) },
          "Cleaning up stale batch (timeout exceeded)"
        );
        staleBatches.push(batch);
      }
    }

    // Process stale batches (handleBatchComplete will clean up the maps)
    for (const batch of staleBatches) {
      this.handleBatchComplete(batch);
    }
  }
}

let mentionHandler: MentionHandler | null = null;

export function initMentionHandler(adapter: AgentAdapter): MentionHandler {
  mentionHandler = new MentionHandler(eventBus, adapter);
  mentionHandler.init();
  return mentionHandler;
}

export function getMentionHandler(): MentionHandler | null {
  return mentionHandler;
}
