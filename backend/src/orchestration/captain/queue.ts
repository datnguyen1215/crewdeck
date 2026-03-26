/**
 * Captain Event Queue
 *
 * Queues events while Captain is processing, drains all when done.
 * Uses a mutex to prevent concurrent LLM calls.
 */

export type CaptainEventType =
  | "issue.created"
  | "issue.updated"
  | "issue.status_changed"
  | "run.completed"
  | "pr.status_changed"
  | "comment.added"
  | "chat.message"
  | "idle.check"
  | "startup.scan"
  | "project.settings_changed";

/** Image content passed with chat messages */
export interface ChatImage {
  data: string;
  mediaType: string;
}

export interface CaptainEvent {
  type: CaptainEventType;
  projectId: string;
  timestamp: Date;
  data: unknown;
  /** Images attached to chat.message events */
  images?: ChatImage[];
}

interface ProjectQueue {
  events: CaptainEvent[];
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
export function enqueue(event: CaptainEvent): void {
  const queue = getQueue(event.projectId);
  queue.events.push(event);
}

/**
 * Try to acquire the processing lock atomically.
 * Returns true if lock acquired, false if already processing.
 * Uses a synchronous check-and-set to prevent race conditions.
 */
export function tryAcquire(projectId: string): boolean {
  const queue = getQueue(projectId);
  // Atomic check-and-set: read and write in single synchronous operation
  // In Node.js single-threaded event loop, this is safe as long as we don't
  // yield between check and set (no await, no callbacks)
  const wasProcessing = queue.processing;
  if (wasProcessing) return false;
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
export function drain(projectId: string): CaptainEvent[] {
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
