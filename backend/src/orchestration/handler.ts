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
import * as log from "../logger.js";
import * as dispatchQueue from "./dispatch-queue.js";
import * as crew from "./crew.js";
import {
  activeProcesses,
  hasActiveAgentProcess,
  markPendingSpawn,
  clearPendingSpawn,
} from "./processes.js";
import {
  batches,
  issueBatches,
  createBatch,
  cleanupStaleBatches,
  clearBatches,
} from "./batch.js";
import { spawnAgent, executeQueuedRun, postSystemComment } from "./spawner.js";
import { BATCH_CLEANUP_INTERVAL_MS as CLEANUP_INTERVAL_MS } from "../config/orchestration.js";

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Wrapper for draining the queue using the DB-backed queue system.
 */
const drainQueue = async (projectId: string): Promise<void> => {
  await dispatchQueue.drainQueue(projectId, executeQueuedRun);
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

    // Guard: Only captain, supervisor, and user can dispatch agents
    // Block dispatches from engineer, inspector, docs, librarian to prevent unauthorized agent spawning
    if (authorAgentId && authorAgentId !== "captain" && authorAgentId !== "supervisor") {
      log.logger.warn(
        {
          authorAgentId,
          issueId: comment.issue_id,
          mentionedAgents: mentioned.map((a) => a.id),
        },
        "Blocked dispatch from non-captain/supervisor agent",
      );
      postSystemComment(
        comment.issue_id,
        project_id,
        `⚠️ Agent "${authorAgentId}" attempted to dispatch agents, but only captain and supervisor have dispatch permission. Dispatches blocked.`,
      );
      return;
    }

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

      // Atomic check-and-mark to prevent duplicate spawns
      // Check if agent is already running/pending and mark as pending in one step
      if (hasActiveAgentProcess(agent.id, comment.issue_id)) {
        log.logger.info(
          { agentId: agent.id, issueId: comment.issue_id },
          "Skipping spawn: agent already running or pending for this issue",
        );
        continue;
      }

      // Mark as pending before spawning (atomic operation)
      if (!markPendingSpawn(agent.id, comment.issue_id)) {
        // Another event already marked this agent+issue as pending
        log.logger.info(
          { agentId: agent.id, issueId: comment.issue_id },
          "Skipping spawn: agent spawn already in progress",
        );
        continue;
      }

      spawnAgent(agent, comment.issue_id, project_id, authorAgentId).catch(
        (err) => {
          // Clear pending marker on failure
          clearPendingSpawn(agent.id, comment.issue_id);
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
