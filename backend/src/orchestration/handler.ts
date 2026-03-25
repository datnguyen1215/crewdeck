/**
 * Core orchestration for /dispatch-driven agent spawning.
 * Listens for comment.added events, parses dispatch commands, spawns agents,
 * and posts results back as comments.
 *
 * When a comment spawns multiple agents, they are grouped as a batch
 * to prevent the originator from being re-spawned while batch members run.
 *
 * Agent runs are persisted to the database with streamed output for real-time progress.
 */
import * as events from "../events/bus.js";
import * as mentionParser from "./parser.js";
import * as issueRepo from "../db/repositories/issues.js";
import * as projectRepo from "../db/repositories/projects.js";
import * as log from "../logger.js";
import * as dispatchQueue from "./queue.js";
import * as crew from "./crew.js";
import {
  activeProcesses,
  getActiveProcessCount,
  hasActiveProcesses,
  hasActiveAgentProcess,
} from "./processes.js";
import {
  batches,
  issueBatches,
  createBatch,
  cleanupStaleBatches,
  clearBatches,
} from "./batch.js";
import { spawnAgent, postSystemComment } from "./spawner.js";

/** Cleanup interval in milliseconds (5 minutes) */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

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
      await spawnAgent(
        agent,
        next.issueId,
        projectId,
        next.commentAuthorAgentId,
      );
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
    // Extract agent ID from author_type (if comment is from an agent, author_type = agent ID)
    const authorAgentId =
      comment.author_type !== "user" && comment.author_type !== "system"
        ? comment.author_type
        : undefined;
    const mentioned = mentionParser.parseDispatches(
      comment.content,
      agents,
      authorAgentId,
    );

    if (mentioned.length === 0) return;

    // Create a batch when an agent dispatches other agents, so the originator is auto-invoked on completion
    if (mentioned.length >= 1 && authorAgentId) {
      const existingBatchId = issueBatches.get(comment.issue_id);
      if (!existingBatchId) {
        createBatch(
          comment.issue_id,
          project_id,
          authorAgentId,
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
            {
              agentId: agent.id,
              issueId: comment.issue_id,
              batchId: existingBatchId,
            },
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

      spawnAgent(agent, comment.issue_id, project_id, authorAgentId).catch(
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
      });
    }
  });

  // Drain queue when an agent completes
  events.eventBus.on("mention.completed", ({ project_id }) => {
    drainQueue(project_id).catch((err) => {
      log.logger.error(
        { err, projectId: project_id },
        "Failed to drain dispatch queue",
      );
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
  clearBatches();
};
