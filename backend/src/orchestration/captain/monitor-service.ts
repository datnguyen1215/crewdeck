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
import { isIssuePaused } from "../../db/repositories/issues.js";
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
import type { CaptainEvent } from "./queue.js";

// Queue namespace prefix to separate monitor from chat queues
const MONITOR_PREFIX = "monitor:";

// Batching window: events arriving within this period are grouped into one LLM call
const BATCH_WINDOW_MS = 5000;

const projectSubscriptions = new Map<string, () => void>();
const batchTimers = new Map<string, NodeJS.Timeout>();

/**
 * Queue an event and trigger processing after a batching window.
 * Events arriving within BATCH_WINDOW_MS are grouped into a single LLM call.
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
  }, BATCH_WINDOW_MS);

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
    }, BATCH_WINDOW_MS);
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

/**
 * Create event handlers for a project (all events except chat.message).
 */
function createProjectHandlers(projectId: string): () => void {
  const handleIssueCreated = (data: {
    issue: {
      project_id: string;
      id: string;
      title: string;
      created_by: string;
    };
  }) => {
    if (data.issue.project_id !== projectId) return;
    // Ignore agent-created issues to prevent chain reactions where Monitor
    // sees its own issue creations and tries to process them
    if (data.issue.created_by === "agent") return;
    queueAndProcess({
      type: "issue.created",
      projectId,
      timestamp: new Date(),
      data,
    }).catch((err) => {
      logger.error(
        { err, projectId },
        "Monitor: Failed to queue issue.created",
      );
    });
  };

  const handleIssueUpdated = (data: {
    project_id: string;
    issue_id: string;
    changes: unknown;
  }) => {
    if (data.project_id !== projectId) return;
    queueAndProcess({
      type: "issue.updated",
      projectId,
      timestamp: new Date(),
      data,
    }).catch((err) => {
      logger.error(
        { err, projectId },
        "Monitor: Failed to queue issue.updated",
      );
    });
  };

  const handleIssueStatusChanged = (data: {
    project_id: string;
    issue_id: string;
    from: string;
    to: string;
  }) => {
    if (data.project_id !== projectId) return;
    queueAndProcess({
      type: "issue.status_changed",
      projectId,
      timestamp: new Date(),
      data,
    }).catch((err) => {
      logger.error(
        { err, projectId },
        "Monitor: Failed to queue issue.status_changed",
      );
    });
  };

  const handleRunCompleted = (data: {
    project_id: string;
    issue_id: string | null;
    agent_id: string;
    status: string;
  }) => {
    if (data.project_id !== projectId) return;
    if (data.issue_id && isIssuePaused(data.issue_id)) return;
    queueAndProcess({
      type: "run.completed",
      projectId,
      timestamp: new Date(),
      data,
    }).catch((err) => {
      logger.error(
        { err, projectId },
        "Monitor: Failed to queue run.completed",
      );
    });
  };

  const handlePRStatusChanged = (data: {
    project_id: string;
    pr_id: string;
    from: string;
    to: string;
  }) => {
    if (data.project_id !== projectId) return;
    queueAndProcess({
      type: "pr.status_changed",
      projectId,
      timestamp: new Date(),
      data,
    }).catch((err) => {
      logger.error(
        { err, projectId },
        "Monitor: Failed to queue pr.status_changed",
      );
    });
  };

  const handleCommentAdded = (data: {
    comment: {
      id: string;
      issue_id: string;
      author_type: string;
      content: string;
    };
    project_id: string;
  }) => {
    if (data.project_id !== projectId) return;
    if (data.comment.author_type !== "user") return;
    queueAndProcess({
      type: "comment.added",
      projectId,
      timestamp: new Date(),
      data,
    }).catch((err) => {
      logger.error(
        { err, projectId },
        "Monitor: Failed to queue comment.added",
      );
    });
  };

  const handleProjectSettingsChanged = (data: {
    project_id: string;
    changes: Record<string, unknown>;
  }) => {
    if (data.project_id !== projectId) return;
    queueAndProcess({
      type: "project.settings_changed",
      projectId,
      timestamp: new Date(),
      data,
    }).catch((err) => {
      logger.error(
        { err, projectId },
        "Monitor: Failed to queue project.settings_changed",
      );
    });
  };

  // Subscribe to all automated events (not chat.message)
  eventBus.on("issue.created", handleIssueCreated);
  eventBus.on("issue.updated", handleIssueUpdated);
  eventBus.on("issue.status_changed", handleIssueStatusChanged);
  eventBus.on("run.completed", handleRunCompleted);
  eventBus.on("pr.status_changed", handlePRStatusChanged);
  eventBus.on("comment.added", handleCommentAdded);
  eventBus.on("project.settings_changed", handleProjectSettingsChanged);

  return () => {
    eventBus.off("issue.created", handleIssueCreated);
    eventBus.off("issue.updated", handleIssueUpdated);
    eventBus.off("issue.status_changed", handleIssueStatusChanged);
    eventBus.off("run.completed", handleRunCompleted);
    eventBus.off("pr.status_changed", handlePRStatusChanged);
    eventBus.off("comment.added", handleCommentAdded);
    eventBus.off("project.settings_changed", handleProjectSettingsChanged);
  };
}

export function startMonitorForProject(projectId: string): void {
  if (projectSubscriptions.has(projectId)) return;

  const project = getProject(projectId);
  if (!project) return;

  const unsubscribe = createProjectHandlers(projectId);
  projectSubscriptions.set(projectId, unsubscribe);

  // Emit startup.scan event with a small delay to ensure recovery cleanup completes first
  const STARTUP_BUFFER_MS = 500;
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
