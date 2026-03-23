/**
 * Admiral Event Queue
 *
 * Queues events while Admiral is processing, drains all when done.
 * Uses a mutex to prevent concurrent LLM calls.
 */

export type AdmiralEventType =
  | "issue.created"
  | "issue.updated"
  | "issue.status_changed"
  | "run.completed"
  | "pr.status_changed"
  | "chat.message"
  | "idle.check";

export interface AdmiralEvent {
  type: AdmiralEventType;
  projectId: string;
  timestamp: Date;
  data: unknown;
}

interface ProjectQueue {
  events: AdmiralEvent[];
  processing: boolean;
}

const queues = new Map<string, ProjectQueue>();

/**
 * Get or create a queue for a project.
 */
function getQueue(projectId: string): ProjectQueue {
  let queue = queues.get(projectId);
  if (!queue) {
    queue = { events: [], processing: false };
    queues.set(projectId, queue);
  }
  return queue;
}

/**
 * Add an event to the queue.
 */
export function enqueue(event: AdmiralEvent): void {
  const queue = getQueue(event.projectId);
  queue.events.push(event);
}

/**
 * Try to acquire the processing lock.
 * Returns true if lock acquired, false if already processing.
 */
export function tryAcquire(projectId: string): boolean {
  const queue = getQueue(projectId);
  if (queue.processing) return false;
  queue.processing = true;
  return true;
}

/**
 * Release the processing lock.
 */
export function release(projectId: string): void {
  const queue = getQueue(projectId);
  queue.processing = false;
}

/**
 * Check if currently processing for a project.
 */
export function isProcessing(projectId: string): boolean {
  return getQueue(projectId).processing;
}

/**
 * Drain all events from the queue.
 * Returns the events and clears the queue.
 */
export function drain(projectId: string): AdmiralEvent[] {
  const queue = getQueue(projectId);
  const events = queue.events;
  queue.events = [];
  return events;
}

/**
 * Check if queue has pending events.
 */
export function hasPending(projectId: string): boolean {
  return getQueue(projectId).events.length > 0;
}

/**
 * Get pending event count.
 */
export function pendingCount(projectId: string): number {
  return getQueue(projectId).events.length;
}

/**
 * Clear queue for a project (used on shutdown or reset).
 */
export function clear(projectId: string): void {
  queues.delete(projectId);
}

/**
 * Clear all queues.
 */
export function clearAll(): void {
  queues.clear();
}
