/**
 * Core orchestration for /dispatch-driven agent spawning.
 * Listens for comment.added events, parses dispatch commands, spawns agents,
 * and posts results back as comments.
 *
 * When a comment spawns multiple agents, they are grouped as a batch.
 * The system tracks batch completion and auto-spawns the originator
 * when all batch members finish.
 */
import { type ChildProcess } from "node:child_process";
import * as events from "../events/bus.js";
import * as mentionParser from "./parser.js";
import * as agentProcess from "../agent/adapters/process.js";
import * as agentPrompt from "../agent/prompt.js";
import * as agentWorktree from "../agent/worktree.js";
import * as crew from "../agents/crew.js";
import * as issueRepo from "../db/repositories/issues.js";
import * as commentRepo from "../db/repositories/comments.js";
import * as projectRepo from "../db/repositories/projects.js";
import * as githubAccountRepo from "../db/repositories/github-accounts.js";
import * as database from "../db/index.js";
import * as log from "../logger.js";
import * as dispatchQueue from "../dispatch/queue.js";
import type { Agent, Comment } from "../types/entities.js";

const MAX_CHAIN_DEPTH = 20;
const PROCESS_TIMEOUT_MS = 10 * 60 * 1000;
/** Default batch timeout in milliseconds (30 minutes) */
const BATCH_TIMEOUT_MS = 30 * 60 * 1000;
/** Cleanup interval in milliseconds (5 minutes) */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

interface ActiveProcess {
  pid: number;
  process: ChildProcess;
  projectId: string;
  issueId: string;
  agentId: string;
  timer: ReturnType<typeof setTimeout>;
}

/** Batch tracking for grouped agent spawns */
interface AgentBatch {
  id: string;
  issueId: string;
  projectId: string;
  originatorAgentId: string;
  memberAgentIds: Set<string>;
  completedAgentIds: Set<string>;
  createdAt: Date;
}

const activeProcesses = new Map<number, ActiveProcess>();
/** Active batches by batch ID */
const batches = new Map<string, AgentBatch>();
/** Map from issueId to active batch ID for that issue */
const issueBatches = new Map<string, string>();
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Count active processes for a project.
 * @param {string} projectId - Project to count for
 * @returns {number} Number of active processes
 */
export const getActiveProcessCount = (projectId: string): number => {
  let count = 0;
  for (const p of activeProcesses.values())
    if (p.projectId === projectId) count++;
  return count;
};

/**
 * Check if an issue has any active processes.
 * @param {string} issueId - Issue to check
 * @returns {boolean} True if processes are running
 */
export const hasActiveProcesses = (issueId: string): boolean => {
  for (const p of activeProcesses.values())
    if (p.issueId === issueId) return true;
  return false;
};

/**
 * Check if a specific agent already has an active process for an issue.
 * @param {string} agentId - Agent to check
 * @param {string} issueId - Issue to check
 * @returns {boolean} True if the agent is already running for this issue
 */
export const hasActiveAgentProcess = (agentId: string, issueId: string): boolean => {
  for (const p of activeProcesses.values())
    if (p.agentId === agentId && p.issueId === issueId) return true;
  return false;
};

/**
 * Post a system comment and emit comment.added.
 * @param {string} issueId - Target issue
 * @param {string} projectId - Parent project
 * @param {string} content - Comment body
 */
const postSystemComment = (issueId: string, projectId: string, content: string): void => {
  const comment = commentRepo.createComment(issueId, {
    content,
    author_type: "system",
  });
  events.eventBus.emit("comment.added", { comment, project_id: projectId });
};

/**
 * Get the first repo for a project.
 * Direct query to avoid circular dependency with repos repository.
 * @param {string} projectId - Project to look up
 * @returns {object|undefined} Repo row or undefined
 */
const getFirstRepo = (projectId: string) => {
  const row = database.db
    .prepare("SELECT * FROM Repo WHERE project_id = ? LIMIT 1")
    .get(projectId);
  return row as
    | {
        id: string;
        project_id: string;
        github_url: string;
        name: string;
        owner: string;
        local_path: string;
        default_branch: string;
      }
    | undefined;
};

/**
 * Load environment variables for a project as key-value pairs.
 * @param {string} projectId - Project to load vars for
 * @returns {Record<string, string>} Environment variable map
 */
const getEnvVars = (projectId: string): Record<string, string> => {
  const rows = database.db
    .prepare("SELECT key, value FROM EnvironmentVariable WHERE project_id = ?")
    .all(projectId) as { key: string; value: string }[];
  const env: Record<string, string> = {};
  for (const row of rows) env[row.key] = row.value;
  return env;
};

/**
 * Create a new batch for tracking grouped agent spawns.
 */
const createBatch = (
  issueId: string,
  projectId: string,
  originatorAgentId: string,
  memberAgentIds: string[],
): string => {
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
  batches.set(batchId, batch);
  issueBatches.set(issueId, batchId);
  log.logger.info(
    { batchId, issueId, originatorAgentId, members: memberAgentIds },
    "Created agent batch",
  );
  return batchId;
};

/**
 * Handle batch completion - auto-spawn the originator agent.
 */
const handleBatchComplete = (batch: AgentBatch): void => {
  log.logger.info(
    { batchId: batch.id, originatorAgentId: batch.originatorAgentId },
    "Batch complete, auto-spawning originator",
  );

  // Clean up batch tracking
  batches.delete(batch.id);
  issueBatches.delete(batch.issueId);

  // Get the originator agent
  const originator = crew.getCrewMember(batch.originatorAgentId);
  if (!originator) {
    log.logger.warn({ agentId: batch.originatorAgentId }, "Batch originator not found");
    return;
  }

  // Create a system comment noting batch completion
  postSystemComment(
    batch.issueId,
    batch.projectId,
    `All batch members have completed. Auto-invoking ${originator.name} for follow-up.`,
  );

  // Spawn the originator
  spawnAgent(originator, batch.issueId, batch.projectId).catch((err) => {
    log.logger.error(
      { err, agent: originator.name, issueId: batch.issueId },
      "Failed to auto-spawn batch originator",
    );
  });
};

/**
 * Clean up stale batches that have exceeded the timeout.
 */
const cleanupStaleBatches = (): void => {
  const now = Date.now();
  const stale: AgentBatch[] = [];

  for (const batch of batches.values()) {
    const age = now - batch.createdAt.getTime();
    if (age > BATCH_TIMEOUT_MS) {
      log.logger.warn(
        { batchId: batch.id, issueId: batch.issueId, age: Math.round(age / 1000 / 60) },
        "Cleaning up stale batch (timeout exceeded)",
      );
      stale.push(batch);
    }
  }

  for (const batch of stale) {
    handleBatchComplete(batch);
  }
};

/**
 * Mark an agent as completed in its batch and check for batch completion.
 */
const markAgentCompleted = (agentId: string, issueId: string): void => {
  const batchId = issueBatches.get(issueId);
  if (!batchId) return;

  const batch = batches.get(batchId);
  if (!batch) return;

  if (!batch.memberAgentIds.has(agentId)) return;

  batch.completedAgentIds.add(agentId);
  log.logger.debug(
    {
      batchId,
      agentId,
      completed: batch.completedAgentIds.size,
      total: batch.memberAgentIds.size,
    },
    "Agent completed in batch",
  );

  if (batch.completedAgentIds.size >= batch.memberAgentIds.size) {
    handleBatchComplete(batch);
  }
};

/**
 * Spawn an agent process for a mentioned agent on an issue.
 * Handles chain depth, concurrency, worktree creation, and process lifecycle.
 * @param {Agent} agent - Agent to spawn
 * @param {string} issueId - Target issue
 * @param {string} projectId - Parent project
 * @param {string} [commentAuthorAgentId] - Author of the triggering comment
 */
const spawnAgent = async (
  agent: Agent,
  issueId: string,
  projectId: string,
  commentAuthorAgentId?: string,
): Promise<void> => {
  const issue = issueRepo.getIssue(issueId);
  if (!issue) return;

  const project = projectRepo.getProject(projectId);
  if (!project) return;

  // Atomic check-and-increment to prevent concurrent mentions from exceeding the limit.
  // If chain_depth is already at MAX, the UPDATE matches zero rows and we reject.
  const incResult = database.db
    .prepare("UPDATE Issue SET chain_depth = chain_depth + 1 WHERE id = ? AND chain_depth < ?")
    .run(issueId, MAX_CHAIN_DEPTH);

  if (incResult.changes === 0) {
    postSystemComment(
      issueId,
      projectId,
      `Chain depth limit reached (${MAX_CHAIN_DEPTH}). No more agents can be spawned on this issue. Use the "Reset chain depth" button to continue.`,
    );
    events.eventBus.emit("mention.chain_depth_reached", {
      issue_id: issueId,
      project_id: projectId,
    });
    return;
  }

  const activeCount = getActiveProcessCount(projectId);
  if (activeCount >= project.max_concurrency) {
    // Don't queue duplicates
    if (dispatchQueue.isQueued(projectId, issueId, agent.id)) {
      postSystemComment(issueId, projectId, `Agent ${agent.name} is already queued`);
      // Rollback the chain_depth increment since we're not spawning
      database.db
        .prepare("UPDATE Issue SET chain_depth = chain_depth - 1 WHERE id = ?")
        .run(issueId);
      return;
    }
    // Queue the dispatch instead of rejecting
    const position = dispatchQueue.enqueue({
      projectId,
      issueId,
      agentId: agent.id,
      queuedAt: new Date(),
      commentAuthorAgentId,
    });
    const ahead = position;
    postSystemComment(
      issueId,
      projectId,
      `Agent ${agent.name} queued${ahead > 0 ? ` (${ahead} agent${ahead === 1 ? "" : "s"} ahead)` : " (next in line)"}`,
    );
    events.eventBus.emit("dispatch.queued", {
      project_id: projectId,
      issue_id: issueId,
      agent_id: agent.id,
      position,
    });
    // Rollback the chain_depth increment since we're not spawning now
    database.db
      .prepare("UPDATE Issue SET chain_depth = chain_depth - 1 WHERE id = ?")
      .run(issueId);
    return;
  }

  // Regress status to in_progress when work restarts
  if (
    issue.status === "done" ||
    issue.status === "pr_created" ||
    issue.status === "open"
  ) {
    issueRepo.updateIssue(issueId, { status: "in_progress" });
    events.eventBus.emit("issue.status_changed", {
      issue_id: issueId,
      project_id: projectId,
      from: issue.status,
      to: "in_progress",
    });
  }

  // Create worktree if needed
  const repo = getFirstRepo(projectId);
  let worktreePath = issue.worktree_path;

  if (!worktreePath && repo) {
    const freshIssue = issueRepo.getIssue(issueId)!;
    const result = await agentWorktree.createWorktree(
      repo as any,
      freshIssue,
      repo.default_branch,
    );
    worktreePath = result.path;
  }

  const comments = commentRepo.listComments(issueId);

  // Captain gets all open/in-progress issues for dependency-aware scheduling
  const projectIssues =
    agent.id === "captain"
      ? issueRepo.listIssues(projectId, { status: ["open", "in_progress"] })
      : undefined;

  const prompt = agentPrompt.buildPrompt({
    issue: issueRepo.getIssue(issueId)!,
    comments,
    repo: repo ?? null,
    worktreePath: worktreePath ?? ".",
    agentId: agent.id,
    projectIssues,
  });

  const envVars = getEnvVars(projectId);
  const env: Record<string, string> = {
    ...envVars,
    CREWDECK_API_URL: `http://localhost:${process.env.PORT || "9381"}`,
    CREWDECK_PROJECT_ID: projectId,
    CREWDECK_AGENT_ID: agent.id,
    CREWDECK_ISSUE_ID: issueId,
  };

  // Captain needs GH_TOKEN for gh pr create
  if (agent.id === "captain" && project.github_account_id) {
    const account = githubAccountRepo.getGitHubAccount(project.github_account_id);
    if (account) env.GH_TOKEN = account.oauth_token;
  }

  const result = await agentProcess.spawnClaude({
    prompt,
    systemPrompt: agent.system_prompt,
    workdir: worktreePath ?? ".",
    env,
  });

  const timer = setTimeout(() => {
    log.logger.warn(
      { pid: result.pid, agentId: agent.id, issueId },
      "Agent process timed out",
    );
    result.process.kill("SIGTERM");
    setTimeout(() => {
      if (!result.process.killed) result.process.kill("SIGKILL");
    }, 5000);
  }, PROCESS_TIMEOUT_MS);

  const entry: ActiveProcess = {
    pid: result.pid,
    process: result.process,
    projectId,
    issueId,
    agentId: agent.id,
    timer,
  };
  activeProcesses.set(result.pid, entry);

  events.eventBus.emit("mention.spawned", {
    project_id: projectId,
    issue_id: issueId,
    agent_id: agent.id,
    pid: result.pid,
  });

  log.logger.info({ pid: result.pid, agent: agent.name, issueId }, "Agent spawned");

  result.exitPromise.then(({ code, stdout }) => {
    clearTimeout(timer);
    activeProcesses.delete(result.pid);

    if (code === 0) {
      let resultText = "";
      let cost: number | undefined;
      let durationMs: number | undefined;

      try {
        const parsed = JSON.parse(stdout);
        // Claude CLI with --output-format json returns a JSON array of events.
        // The final element with type "result" contains the actual output.
        const resultObj = Array.isArray(parsed)
          ? parsed.findLast((e: any) => e.type === "result") ?? parsed
          : parsed;
        resultText = resultObj.result ?? stdout;
        cost = resultObj.cost_usd ?? resultObj.total_cost_usd;
        durationMs = resultObj.duration_ms;
      } catch {
        resultText = stdout;
      }

      if (resultText) {
        const comment = commentRepo.createComment(issueId, {
          content: resultText,
          author_type: "agent",
          author_id: agent.id,
        });
        events.eventBus.emit("comment.added", { comment, project_id: projectId });
      }

      postSystemComment(
        issueId,
        projectId,
        `Agent ${agent.name} finished${cost ? ` (cost: $${cost.toFixed(4)})` : ""}${durationMs ? ` (${Math.round(durationMs / 1000)}s)` : ""}`,
      );

      log.logger.info(
        { pid: result.pid, agent: agent.name, cost, durationMs },
        "Agent finished",
      );
    } else {
      const hasOutput = stdout.trim().length > 0;
      postSystemComment(
        issueId,
        projectId,
        `Agent ${agent.name} ${code === null ? "timed out (10 min limit" : `crashed (exit code ${code}`}${hasOutput ? "" : ", no output"})`,
      );
      log.logger.error(
        { pid: result.pid, code, agent: agent.name },
        "Agent process failed",
      );
    }

    // Track batch completion
    markAgentCompleted(agent.id, issueId);

    events.eventBus.emit("mention.completed", {
      project_id: projectId,
      issue_id: issueId,
      agent_id: agent.id,
      exit_code: code,
    });
  });
};

/**
 * Process the dispatch queue for a project after an agent completes.
 * Spawns the next queued agent if concurrency allows.
 */
const drainQueue = async (projectId: string): Promise<void> => {
  const project = projectRepo.getProject(projectId);
  if (!project) return;

  while (true) {
    const activeCount = getActiveProcessCount(projectId);
    if (activeCount >= project.max_concurrency) return;

    const next = dispatchQueue.dequeue(projectId);
    if (!next) return;

    const agent = crew.getCrewMember(next.agentId);
    if (!agent) {
      log.logger.warn({ agentId: next.agentId }, "Queued agent not found");
      continue;
    }

    // Skip if agent already has an active process for this issue
    if (hasActiveAgentProcess(agent.id, next.issueId)) {
      log.logger.info(
        { agentId: agent.id, issueId: next.issueId },
        "Skipping queued spawn: agent already running for this issue",
      );
      continue;
    }

    postSystemComment(
      next.issueId,
      projectId,
      `Agent ${agent.name} dequeued, spawning now`,
    );

    events.eventBus.emit("dispatch.dequeued", {
      project_id: projectId,
      issue_id: next.issueId,
      agent_id: next.agentId,
    });

    try {
      await spawnAgent(agent, next.issueId, projectId, next.commentAuthorAgentId);
    } catch (err) {
      log.logger.error(
        { err, agent: agent.name, issueId: next.issueId },
        "Failed to spawn queued agent",
      );
      events.eventBus.emit("mention.error", {
        project_id: projectId,
        issue_id: next.issueId,
        agent_id: agent.id,
        message: err instanceof Error ? err.message : "unknown error",
      });
      postSystemComment(
        next.issueId,
        projectId,
        `Failed to spawn queued agent ${agent.name}: ${err instanceof Error ? err.message : "unknown error"}`,
      );
      // Spawn failed — continue draining so the slot isn't wasted
      continue;
    }
  }
};

/**
 * Initialize the mention handler by subscribing to comment.added events.
 */
export const initMentionHandler = (): void => {
  events.eventBus.on("comment.added", ({ comment, project_id }) => {
    // Skip system comments to avoid infinite loops
    if (comment.author_type === "system") return;

    const issue = issueRepo.getIssue(comment.issue_id);
    if (!issue) return;

    const agents = crew.listCrew();
    const mentioned = mentionParser.parseDispatches(
      comment.content,
      agents,
      comment.author_id ?? undefined,
    );

    if (mentioned.length === 0) return;

    // Create a batch if multiple agents are being spawned by an agent author
    if (mentioned.length > 1 && comment.author_id) {
      const existingBatchId = issueBatches.get(comment.issue_id);
      if (!existingBatchId) {
        createBatch(
          comment.issue_id,
          project_id,
          comment.author_id,
          mentioned.map((a) => a.id),
        );
      }
    }

    for (const agent of mentioned) {
      // Skip spawning the batch originator if there's a pending batch
      const existingBatchId = issueBatches.get(comment.issue_id);
      if (existingBatchId) {
        const batch = batches.get(existingBatchId);
        if (batch && batch.originatorAgentId === agent.id) {
          log.logger.debug(
            { agentId: agent.id, issueId: comment.issue_id, batchId: existingBatchId },
            "Skipping spawn: agent is batch originator with pending batch",
          );
          continue;
        }
      }

      // Skip if agent already has an active process for this issue
      if (hasActiveAgentProcess(agent.id, comment.issue_id)) {
        log.logger.info(
          { agentId: agent.id, issueId: comment.issue_id },
          "Skipping spawn: agent already running for this issue",
        );
        continue;
      }

      spawnAgent(agent, comment.issue_id, project_id, comment.author_id ?? undefined).catch(
        (err) => {
          log.logger.error(
            { err, agent: agent.name, issueId: comment.issue_id },
            "Failed to spawn agent",
          );
          events.eventBus.emit("mention.error", {
            project_id,
            issue_id: comment.issue_id,
            agent_id: agent.id,
            message: err instanceof Error ? err.message : "unknown error",
          });
          postSystemComment(
            comment.issue_id,
            project_id,
            `Failed to spawn agent ${agent.name}: ${err instanceof Error ? err.message : "unknown error"}`,
          );
        },
      );
    }
  });

  // Drain queue when an agent completes
  events.eventBus.on("mention.completed", ({ project_id }) => {
    drainQueue(project_id).catch((err) => {
      log.logger.error({ err, projectId: project_id }, "Failed to drain dispatch queue");
    });
  });

  // Start periodic cleanup of stale batches
  cleanupInterval = setInterval(() => {
    cleanupStaleBatches();
  }, CLEANUP_INTERVAL_MS);

  log.logger.info("MentionHandler initialized");
};

/**
 * Terminate all active processes and clear tracking state.
 */
export const shutdownMentionHandler = (): void => {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  for (const entry of activeProcesses.values()) {
    clearTimeout(entry.timer);
    entry.process.kill("SIGTERM");
  }
  activeProcesses.clear();
  batches.clear();
  issueBatches.clear();
};

/**
 * Log startup recovery. Spawns from before a crash are lost.
 */
export const recoverOnStartup = (): void => {
  log.logger.info("MentionHandler startup recovery complete");
};
