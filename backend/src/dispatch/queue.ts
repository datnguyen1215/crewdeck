/**
 * In-memory per-project FIFO queue for agent dispatches.
 * When concurrency limits are reached, dispatches are queued here
 * instead of being rejected.
 *
 * Queue is in-memory; queued dispatches are lost on restart (same as active processes).
 * No explicit queue size limit — bounded implicitly by chain_depth and practical dispatch rates.
 */
import * as log from "../logger.js";

export interface QueuedDispatch {
  projectId: string;
  issueId: string;
  agentId: string;
  queuedAt: Date;
  /** Comment author agent ID, if the dispatch was triggered by an agent */
  commentAuthorAgentId?: string;
}

/** Per-project queues: projectId -> array of queued dispatches (FIFO) */
const queues = new Map<string, QueuedDispatch[]>();

/**
 * Add a dispatch to the queue for a project.
 * @returns Queue position (0-indexed, where 0 means first in queue)
 */
export const enqueue = (dispatch: QueuedDispatch): number => {
  let queue = queues.get(dispatch.projectId);
  if (!queue) {
    queue = [];
    queues.set(dispatch.projectId, queue);
  }
  queue.push(dispatch);
  log.logger.info(
    { projectId: dispatch.projectId, issueId: dispatch.issueId, agentId: dispatch.agentId, position: queue.length - 1 },
    "Dispatch queued"
  );
  return queue.length - 1;
};

/**
 * Remove and return the next dispatch from the queue.
 * @param projectId - Project to dequeue from
 * @returns The next queued dispatch, or undefined if queue is empty
 */
export const dequeue = (projectId: string): QueuedDispatch | undefined => {
  const queue = queues.get(projectId);
  if (!queue || queue.length === 0) return undefined;
  const dispatch = queue.shift();
  if (dispatch) {
    log.logger.info(
      { projectId, issueId: dispatch.issueId, agentId: dispatch.agentId },
      "Dispatch dequeued"
    );
  }
  return dispatch;
};

/**
 * Get the position of a specific dispatch in the queue.
 * @returns Position (0-indexed), or -1 if not found
 */
export const getQueuePosition = (
  projectId: string,
  issueId: string,
  agentId: string
): number => {
  const queue = queues.get(projectId);
  if (!queue) return -1;
  return queue.findIndex(
    (d) => d.issueId === issueId && d.agentId === agentId
  );
};

/**
 * Get the number of queued dispatches for a project.
 */
export const getQueueLength = (projectId: string): number => {
  const queue = queues.get(projectId);
  return queue?.length ?? 0;
};

/**
 * Peek at the next dispatch without removing it.
 */
export const peek = (projectId: string): QueuedDispatch | undefined => {
  const queue = queues.get(projectId);
  return queue?.[0];
};

/**
 * Check if a specific agent/issue combination is already queued.
 */
export const isQueued = (
  projectId: string,
  issueId: string,
  agentId: string
): boolean => {
  return getQueuePosition(projectId, issueId, agentId) >= 0;
};

/**
 * Clear all queued dispatches for a project.
 * Useful for cleanup/testing.
 */
export const clearQueue = (projectId: string): void => {
  queues.delete(projectId);
};

/**
 * Clear all queues. Useful for testing.
 */
export const clearAllQueues = (): void => {
  queues.clear();
};

/**
 * Get all queued dispatches for a project (readonly).
 */
export const getQueue = (projectId: string): readonly QueuedDispatch[] => {
  return queues.get(projectId) ?? [];
};
