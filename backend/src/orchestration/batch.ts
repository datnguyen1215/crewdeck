/**
 * Batch tracking for grouped agent spawns.
 *
 * Note: Captain now directly dispatches sub-agents and
 * reacts to run.completed events. The batch system is no longer used for
 * auto-spawning but remains for potential future use or can be removed
 * entirely in a follow-up cleanup.
 */
import * as log from "../logger.js";

/** Default batch timeout in milliseconds (30 minutes) */
const BATCH_TIMEOUT_MS = 30 * 60 * 1000;

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

/** Active batches by batch ID */
export const batches = new Map<string, AgentBatch>();
/** Map from issueId to active batch ID for that issue */
export const issueBatches = new Map<string, string>();

/**
 * Create a new batch for tracking grouped agent spawns.
 */
export const createBatch = (
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
 * Handle batch completion.
 * We just clean up state and log. Captain reacts to individual
 * run.completed events instead of batch completions.
 */
export const handleBatchComplete = (batch: AgentBatch): void => {
  log.logger.info(
    { batchId: batch.id, issueId: batch.issueId },
    "Batch complete",
  );

  // Clean up batch tracking
  batches.delete(batch.id);
  issueBatches.delete(batch.issueId);
};

/**
 * Clean up stale batches that have exceeded the timeout.
 */
export const cleanupStaleBatches = (): void => {
  const now = Date.now();
  const stale: AgentBatch[] = [];

  for (const batch of batches.values()) {
    const age = now - batch.createdAt.getTime();
    if (age > BATCH_TIMEOUT_MS) {
      log.logger.warn(
        {
          batchId: batch.id,
          issueId: batch.issueId,
          age: Math.round(age / 1000 / 60),
        },
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
export const markAgentCompleted = (agentId: string, issueId: string): void => {
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
 * Clear all batch tracking state.
 */
export const clearBatches = (): void => {
  batches.clear();
  issueBatches.clear();
};
