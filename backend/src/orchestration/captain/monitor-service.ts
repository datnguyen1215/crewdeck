/**
 * Monitor Service
 *
 * Handles automated orchestration events (issue lifecycle, agent runs, PR status).
 * Subscribes to eventBus events, queues them, and processes batches through the
 * Monitor LLM agent. Does NOT handle user chat messages.
 */
import { eventBus } from "../../events/bus.js";
import { logger } from "../../logger.js";
import {
  getProject,
  listProjects,
  updateCaptainStatus,
} from "../../db/repositories/projects.js";
import { isIssuePaused } from "../../services/issue-service.js";
import {
  enqueue,
  tryAcquire,
  release,
  drain,
  hasPending,
  pendingCount,
} from "./queue.js";
import { processWithLLM } from "./monitor-agent.js";
import { RECOVERY_DELAY_MS } from "../recovery.js";
import type { CaptainEvent, CaptainEventType } from "./queue.js";
import type { EventMap } from "../../events/types.js";
import {
  EVENT_BATCHING_WINDOW_MS,
  STARTUP_BUFFER_MS,
} from "../../config/orchestration.js";

// Queue namespace prefix to separate monitor from chat queues
const MONITOR_PREFIX = "monitor:";

const projectSubscriptions = new Map<string, () => void>();
const batchTimers = new Map<string, NodeJS.Timeout>();

/**
 * Queue an event and trigger processing after a batching window.
 * Events arriving within EVENT_BATCHING_WINDOW_MS are grouped into a single LLM call.
 */
async function queueAndProcess(event: CaptainEvent): Promise<void> {
  const { projectId } = event;
  const queueKey = `${MONITOR_PREFIX}${projectId}`;

  const project = getProject(projectId);
  if (!project) return;

  enqueue({ ...event, projectId: queueKey });

  // Update pending count in DB so REST callers can see queued events.
  // Only set receiving if not already in a more advanced phase (thinking/executing)
  // to avoid regressing the status while the processor is mid-flight.
  try {
    const current = getProject(projectId);
    const currentStatus = current?.captain_status ?? "idle";
    if (currentStatus === "idle" || currentStatus === "receiving") {
      updateCaptainStatus(projectId, "receiving", null, pendingCount(queueKey));
    }
  } catch (err) {
    logger.warn(
      { err, projectId },
      "Monitor: Failed to update captain status to receiving",
    );
  }

  // If a batch timer is already running, the event is queued; don't start a new timer.
  if (batchTimers.has(projectId)) {
    logger.debug(
      { projectId, eventType: event.type },
      "Monitor: Event queued, batch timer already running",
    );
    return;
  }

  // Start a new batch window. When it fires, acquire lock and process all queued events.
  const timer = setTimeout(() => {
    batchTimers.delete(projectId);
    processBatch(projectId, queueKey).catch((err) => {
      logger.error({ err, projectId }, "Monitor: Batch processing failed");
    });
  }, EVENT_BATCHING_WINDOW_MS);

  batchTimers.set(projectId, timer);
  logger.debug(
    { projectId, eventType: event.type },
    "Monitor: Started batch timer",
  );
}

/**
 * Process the event batch after the batching window closes.
 */
async function processBatch(
  projectId: string,
  queueKey: string,
): Promise<void> {
  if (!tryAcquire(queueKey)) {
    // Another batch is already processing; re-arm a timer to try again later.
    logger.debug({ projectId }, "Monitor: Lock held, rescheduling batch");
    const timer = setTimeout(() => {
      batchTimers.delete(projectId);
      processBatch(projectId, queueKey).catch((err) => {
        logger.error({ err, projectId }, "Monitor: Rescheduled batch failed");
      });
    }, EVENT_BATCHING_WINDOW_MS);
    batchTimers.set(projectId, timer);
    return;
  }

  try {
    await processQueue(projectId, queueKey);
  } finally {
    release(queueKey);
    try {
      updateCaptainStatus(projectId, "idle");
    } catch (err) {
      logger.warn(
        { err, projectId },
        "Monitor: Failed to update captain status to idle",
      );
    }
  }
}

/**
 * Process all pending events in the queue.
 */
async function processQueue(
  projectId: string,
  queueKey: string,
): Promise<void> {
  while (hasPending(queueKey)) {
    const events = drain(queueKey).map((e) => ({
      ...e,
      projectId, // restore original projectId for the agent
    }));
    if (events.length === 0) break;

    logger.info(
      { projectId, eventCount: events.length },
      "Monitor: Processing event batch",
    );

    try {
      await processWithLLM(projectId, events);
    } catch (err) {
      logger.error({ err, projectId }, "Monitor: Failed to process events");
    }
  }
}

// Domain-specific filter predicates
const notAgentCreated = (data: { issue: { created_by: string } }) =>
  data.issue.created_by !== "agent";

const notIssuePaused = (data: { issue_id: string | null }) =>
  !(data.issue_id && isIssuePaused(data.issue_id));

const userAuthorOnly = (data: { comment: { author_type: string } }) =>
  data.comment.author_type === "user";

type AnyData = Record<string, unknown>;

// Event types handled by the monitor (subset of EventMap that are also CaptainEventType)
type MonitorEventType = CaptainEventType & keyof EventMap;

interface HandlerConfig {
  eventType: MonitorEventType;
  // dot-separated path to project_id within the event data
  projectIdPath: string;
  filter?: (data: never) => boolean;
}

const HANDLER_CONFIGS: HandlerConfig[] = [
  // Ignore agent-created issues to prevent chain reactions where Monitor
  // sees its own issue creations and tries to process them
  {
    eventType: "issue.created",
    projectIdPath: "issue.project_id",
    filter: notAgentCreated as never,
  },
  { eventType: "issue.updated", projectIdPath: "project_id" },
  {
    eventType: "issue.status_changed",
    projectIdPath: "project_id",
    filter: notIssuePaused as never,
  },
  {
    eventType: "run.completed",
    projectIdPath: "project_id",
    filter: notIssuePaused as never,
  },
  { eventType: "pr.status_changed", projectIdPath: "project_id" },
  {
    eventType: "comment.added",
    projectIdPath: "project_id",
    filter: userAuthorOnly as never,
  },
  { eventType: "project.settings_changed", projectIdPath: "project_id" },
  { eventType: "issue.approved_to_start", projectIdPath: "project_id" },
  { eventType: "issue.approved_to_merge", projectIdPath: "project_id" },
];

function getNestedValue(obj: AnyData, path: string): unknown {
  return path
    .split(".")
    .reduce((cur: unknown, key) => (cur as AnyData)?.[key], obj);
}

/**
 * Create event handlers for a project (all events except chat.message).
 */
function createProjectHandlers(projectId: string): () => void {
  const handlers = HANDLER_CONFIGS.map(
    ({ eventType, projectIdPath, filter }) => {
      const handler = (data: never) => {
        if (getNestedValue(data as AnyData, projectIdPath) !== projectId)
          return;
        if (filter && !filter(data)) return;
        queueAndProcess({
          type: eventType,
          projectId,
          timestamp: new Date(),
          data,
        }).catch((err) => {
          logger.error(
            { err, projectId },
            `Monitor: Failed to queue ${eventType}`,
          );
        });
      };
      return { eventType, handler };
    },
  );

  for (const { eventType, handler } of handlers) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventBus.on(eventType, handler as any);
  }

  return () => {
    for (const { eventType, handler } of handlers) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventBus.off(eventType, handler as any);
    }
  };
}

export function startMonitorForProject(projectId: string): void {
  if (projectSubscriptions.has(projectId)) return;

  const project = getProject(projectId);
  if (!project) return;

  const unsubscribe = createProjectHandlers(projectId);
  projectSubscriptions.set(projectId, unsubscribe);

  // Emit startup.scan event with a small delay to ensure recovery cleanup completes first
  setTimeout(() => {
    const event: CaptainEvent = {
      type: "startup.scan",
      projectId,
      timestamp: new Date(),
      data: {},
    };
    queueAndProcess(event).catch((err) => {
      logger.error({ err, projectId }, "Monitor: Startup scan failed");
    });
  }, RECOVERY_DELAY_MS + STARTUP_BUFFER_MS);

  logger.info({ projectId }, "Monitor service started for project");
}

export function stopMonitorForProject(projectId: string): void {
  const unsubscribe = projectSubscriptions.get(projectId);
  if (unsubscribe) {
    unsubscribe();
    projectSubscriptions.delete(projectId);
  }

  // Cancel any pending batch timer
  const timer = batchTimers.get(projectId);
  if (timer) {
    clearTimeout(timer);
    batchTimers.delete(projectId);
  }

  logger.info({ projectId }, "Monitor service stopped for project");
}

export function initMonitorService(): void {
  const projects = listProjects();
  for (const project of projects) {
    startMonitorForProject(project.id);
  }
  logger.info({ projectCount: projects.length }, "Monitor service initialized");
}

export function shutdownMonitorService(): void {
  for (const [projectId, unsubscribe] of projectSubscriptions) {
    unsubscribe();
    logger.debug({ projectId }, "Monitor service stopped");
  }
  projectSubscriptions.clear();

  // Clear all pending batch timers to prevent post-shutdown processing
  for (const timer of batchTimers.values()) {
    clearTimeout(timer);
  }
  batchTimers.clear();

  logger.info("Monitor service shutdown complete");
}
