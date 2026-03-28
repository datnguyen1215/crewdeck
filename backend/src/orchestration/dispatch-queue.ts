/**
 * DB-backed dispatch queue for agent runs.
 * Replaces the in-memory queue with persistent storage using AgentRun table.
 * Supports global and per-project concurrency limits.
 */
import * as log from "../logger.js";
import * as agentRunRepo from "../db/repositories/agent-runs.js";
import * as projectRepo from "../db/repositories/projects.js";
import * as crew from "./crew.js";
import { config } from "../config.js";
import type { AgentRun } from "../types/entities.js";

/**
 * Enqueue an agent run by creating a record with status='queued'.
 * Returns the AgentRun ID.
 */
export const enqueueRun = (
  projectId: string,
  issueId: string,
  agentId: string,
): string | null => {
  // Reject non-dispatchable agents (captain is a background monitor, not spawnable)
  const agent = crew.getCrewMember(agentId);
  if (agent?.dispatchable === false) {
    log.logger.warn(
      { projectId, issueId, agentId },
      "Rejected enqueue for non-dispatchable agent",
    );
    return null;
  }

  const run = agentRunRepo.createAgentRun({
    project_id: projectId,
    issue_id: issueId,
    agent_id: agentId,
    status: "queued",
  });

  log.logger.info(
    { projectId, issueId, agentId, runId: run.id },
    "Agent run queued",
  );

  return run.id;
};

/**
 * Check if a specific agent/issue combination is already queued or running.
 */
export const isAgentActive = (
  projectId: string,
  issueId: string,
  agentId: string,
): boolean => {
  const queuedRuns = agentRunRepo.listQueuedRuns(projectId);
  const hasQueued = queuedRuns.some(
    (run) => run.issue_id === issueId && run.agent_id === agentId,
  );
  if (hasQueued) return true;

  const runningRuns = agentRunRepo.listActiveRunsForProject(projectId);
  const hasRunning = runningRuns.some(
    (run) =>
      run.status === "running" &&
      run.issue_id === issueId &&
      run.agent_id === agentId,
  );
  return hasRunning;
};

/**
 * Get the queue position for a specific agent/issue combination.
 * Returns 0-indexed position, or -1 if not found.
 */
export const getQueuePosition = (
  projectId: string,
  issueId: string,
  agentId: string,
): number => {
  const queuedRuns = agentRunRepo.listQueuedRuns(projectId);
  return queuedRuns.findIndex(
    (run) => run.issue_id === issueId && run.agent_id === agentId,
  );
};

/**
 * Get the number of queued runs for a project.
 */
export const getQueueLength = (projectId: string): number => {
  return agentRunRepo.listQueuedRuns(projectId).length;
};

/**
 * Drain the queue: spawn queued agents as slots become available.
 * Called after an agent completes to fill empty slots.
 * Returns the AgentRun that was dequeued, or null if none available.
 */
export const drainQueue = async (
  projectId: string,
  executeQueuedRun: (run: AgentRun) => Promise<void>,
): Promise<void> => {
  const project = projectRepo.getProject(projectId);
  if (!project) return;

  const maxGlobal = config.maxAgents;

  while (true) {
    // Check global limit
    const globalRunning = agentRunRepo.countRunningGlobal();
    if (globalRunning >= maxGlobal) {
      log.logger.debug(
        { globalRunning, maxGlobal },
        "Global concurrency limit reached, stopping queue drain",
      );
      return;
    }

    // Check project limit
    const projectRunning = agentRunRepo.countRunningForProject(projectId);
    if (projectRunning >= project.max_concurrency) {
      log.logger.debug(
        { projectRunning, maxConcurrency: project.max_concurrency, projectId },
        "Project concurrency limit reached, stopping queue drain",
      );
      return;
    }

    // Get next queued run
    const queuedRuns = agentRunRepo.listQueuedRuns(projectId);
    if (queuedRuns.length === 0) {
      return;
    }

    const run = queuedRuns[0];
    if (!run.issue_id) {
      log.logger.warn({ runId: run.id }, "Queued run has no issue_id, skipping");
      agentRunRepo.updateAgentRun(run.id, { status: "failed" });
      continue;
    }

    const agent = crew.getCrewMember(run.agent_id);
    if (!agent) {
      log.logger.warn(
        { agentId: run.agent_id, runId: run.id },
        "Queued agent not found",
      );
      agentRunRepo.updateAgentRun(run.id, { status: "failed" });
      continue;
    }

    // Skip non-dispatchable agents (e.g. captain is a background monitor, not spawnable)
    if (agent.dispatchable === false) {
      log.logger.warn(
        { agentId: agent.id, runId: run.id },
        "Queued agent is not dispatchable, marking as failed",
      );
      agentRunRepo.updateAgentRun(run.id, { status: "failed" });
      continue;
    }

    log.logger.info(
      { agentId: agent.id, issueId: run.issue_id, runId: run.id },
      "Dequeuing agent run",
    );

    try {
      await executeQueuedRun(run);
    } catch (err) {
      log.logger.error(
        { err, agent: agent.name, issueId: run.issue_id, runId: run.id },
        "Failed to execute queued run",
      );
      agentRunRepo.updateAgentRun(run.id, { status: "failed" });
      // Continue draining so the slot isn't wasted
      continue;
    }
  }
};

/**
 * Recover queued runs on startup.
 * Marks any runs that were 'running' as 'failed' (lost due to restart).
 * Returns count of recovered runs.
 */
export const recoverQueue = (): {
  markedFailed: number;
  queued: number;
} => {
  const runningRuns = agentRunRepo.listRunningAgentRuns();

  let markedFailed = 0;
  for (const run of runningRuns) {
    agentRunRepo.markRunFailed(run.id);
    markedFailed++;
    log.logger.info(
      { runId: run.id, agentId: run.agent_id, issueId: run.issue_id },
      "Marked orphaned running run as failed",
    );
  }

  const queuedRuns = agentRunRepo.listQueuedRuns();
  log.logger.info(
    { markedFailed, queued: queuedRuns.length },
    "Queue recovery complete",
  );

  return { markedFailed, queued: queuedRuns.length };
};
