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
  | "idle.check"
  | "startup.scan"
  | "project.settings_changed";

export interface CaptainEvent {
  type: CaptainEventType;
  projectId: string;
  timestamp: Date;
  data: unknown;
}

interface ProjectQueue {
  events: CaptainEvent[];
  processing: boolean;
}

const queues = new Map<string, ProjectQueue>();

function getQueue(projectId: string): ProjectQueue {
  let queue = queues.get(projectId);
  if (!queue) {
    queue = { events: [], processing: false };
    queues.set(projectId, queue);
  }
  return queue;
}

export function enqueue(event: CaptainEvent): void {
  const queue = getQueue(event.projectId);
  queue.events.push(event);
}

export function tryAcquire(projectId: string): boolean {
  const queue = getQueue(projectId);
  const wasProcessing = queue.processing;
  if (wasProcessing) return false;
  queue.processing = true;
  return true;
}

export function release(projectId: string): void {
  const queue = getQueue(projectId);
  queue.processing = false;
}

export function isProcessing(projectId: string): boolean {
  return getQueue(projectId).processing;
}

export function drain(projectId: string): CaptainEvent[] {
  const queue = getQueue(projectId);
  const events = queue.events;
  queue.events = [];
  return events;
}

export function hasPending(projectId: string): boolean {
  return getQueue(projectId).events.length > 0;
}

export function pendingCount(projectId: string): number {
  return getQueue(projectId).events.length;
}

export function clear(projectId: string): void {
  queues.delete(projectId);
}

export function clearAll(): void {
  queues.clear();
}
