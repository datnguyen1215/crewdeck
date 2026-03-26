/**
 * Monitor Service
 *
 * Handles automated orchestration events (issue lifecycle, agent runs, PR status).
 * Subscribes to eventBus events, queues them, and processes batches through the
 * Monitor LLM agent. Does NOT handle user chat messages.
 */
import { eventBus } from "../../events/bus.js";
import { logger } from "../../logger.js";
import { getProject, listProjects } from "../../db/repositories/projects.js";
import { enqueue, tryAcquire, release, drain, hasPending } from "./queue.js";
import { processWithLLM } from "./monitor-agent.js";
import { RECOVERY_DELAY_MS } from "../recovery.js";
import type { CaptainEvent } from "./queue.js";

// Queue namespace prefix to separate monitor from chat queues
const MONITOR_PREFIX = "monitor:";

const projectSubscriptions = new Map<string, () => void>();
const idleTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Queue an event and trigger processing if not already running.
 */
async function queueAndProcess(event: CaptainEvent): Promise<void> {
  const { projectId } = event;
  const queueKey = `${MONITOR_PREFIX}${projectId}`;

  const project = getProject(projectId);
  if (!project) return;

  enqueue({ ...event, projectId: queueKey });
  resetIdleTimeout(projectId);

  if (!tryAcquire(queueKey)) {
    logger.debug(
      { projectId, eventType: event.type },
      "Monitor: Event queued while processing",
    );
    return;
  }

  try {
    await processQueue(projectId, queueKey);
  } finally {
    release(queueKey);
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
 * Reset the idle timeout for a project.
 */
function resetIdleTimeout(projectId: string): void {
  const existing = idleTimeouts.get(projectId);
  if (existing) {
    clearTimeout(existing);
    idleTimeouts.delete(projectId);
  }

  const project = getProject(projectId);
  if (!project?.captain_idle_timeout_ms) return;

  const timeout = setTimeout(() => {
    idleTimeouts.delete(projectId);
    triggerIdleCheck(projectId);
  }, project.captain_idle_timeout_ms);

  idleTimeouts.set(projectId, timeout);
}

/**
 * Trigger an idle check event.
 */
function triggerIdleCheck(projectId: string): void {
  const event: CaptainEvent = {
    type: "idle.check",
    projectId,
    timestamp: new Date(),
    data: {},
  };
  queueAndProcess(event).catch((err) => {
    logger.error({ err, projectId }, "Monitor: Idle check failed");
  });
}

/**
 * Create event handlers for a project (all events except chat.message).
 */
function createProjectHandlers(projectId: string): () => void {
  const handleIssueCreated = (data: {
    issue: { project_id: string; id: string; title: string; created_by: string };
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

    const timeout = idleTimeouts.get(projectId);
    if (timeout) {
      clearTimeout(timeout);
      idleTimeouts.delete(projectId);
    }
  };
}

export function startMonitorForProject(projectId: string): void {
  if (projectSubscriptions.has(projectId)) return;

  const project = getProject(projectId);
  if (!project) return;

  const unsubscribe = createProjectHandlers(projectId);
  projectSubscriptions.set(projectId, unsubscribe);

  if (project.captain_idle_timeout_ms) {
    resetIdleTimeout(projectId);
  }

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
    logger.info({ projectId }, "Monitor service stopped for project");
  }
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
  idleTimeouts.clear();
  logger.info("Monitor service shutdown complete");
}
