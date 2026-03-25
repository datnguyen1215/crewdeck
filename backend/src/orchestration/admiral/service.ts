/**
 * Admiral Service
 *
 * Connects the event queue to the LLM agent. Subscribes to eventBus events,
 * queues them, and processes batches through the Admiral LLM.
 */
import { eventBus } from "../../events/bus.js";
import { logger } from "../../logger.js";
import { getProject, listProjects } from "../../db/repositories/projects.js";
import { enqueue, tryAcquire, release, drain, hasPending } from "./queue.js";
import { processWithLLM } from "./agent.js";
import type { AdmiralEvent } from "./queue.js";

// Track subscriptions per project for cleanup
const projectSubscriptions = new Map<string, () => void>();

// Idle timeout handles per project
const idleTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Queue an event and trigger processing if not already running.
 */
async function queueAndProcess(event: AdmiralEvent): Promise<void> {
  const { projectId } = event;

  // Check if project has admiral enabled
  const project = getProject(projectId);
  if (!project?.captain_enabled) return;

  enqueue(event);

  // Reset idle timeout when any event arrives
  resetIdleTimeout(projectId);

  // Try to acquire the processing lock
  if (!tryAcquire(projectId)) {
    // Another process is handling it, event is queued for later
    logger.debug(
      { projectId, eventType: event.type },
      "Admiral: Event queued while processing",
    );
    return;
  }

  // Process all queued events
  try {
    await processQueue(projectId);
  } finally {
    release(projectId);
  }
}

/**
 * Process all pending events in the queue.
 * Continues draining until queue is empty (handles events that arrive during processing).
 */
async function processQueue(projectId: string): Promise<void> {
  while (hasPending(projectId)) {
    const events = drain(projectId);
    if (events.length === 0) break;

    logger.info(
      { projectId, eventCount: events.length },
      "Admiral: Processing event batch",
    );

    try {
      await processWithLLM(projectId, events);
    } catch (err) {
      logger.error({ err, projectId }, "Admiral: Failed to process events");
    }

    // Continue loop to check if new events arrived during processing
  }
}

/**
 * Reset the idle timeout for a project.
 */
function resetIdleTimeout(projectId: string): void {
  // Clear existing timeout
  const existing = idleTimeouts.get(projectId);
  if (existing) {
    clearTimeout(existing);
    idleTimeouts.delete(projectId);
  }

  // Get project's idle timeout setting
  const project = getProject(projectId);
  if (!project?.captain_idle_timeout_ms) return;

  // Set new timeout
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
  const event: AdmiralEvent = {
    type: "idle.check",
    projectId,
    timestamp: new Date(),
    data: {},
  };
  queueAndProcess(event).catch((err) => {
    logger.error({ err, projectId }, "Admiral: Idle check failed");
  });
}

/**
 * Create event handlers for a project.
 */
function createProjectHandlers(projectId: string): () => void {
  // Handler for issue events
  const handleIssueCreated = (data: {
    issue: { project_id: string; id: string; title: string };
  }) => {
    if (data.issue.project_id !== projectId) return;
    const event: AdmiralEvent = {
      type: "issue.created",
      projectId,
      timestamp: new Date(),
      data,
    };
    queueAndProcess(event).catch((err) => {
      logger.error(
        { err, projectId },
        "Admiral: Failed to queue issue.created",
      );
    });
  };

  const handleIssueUpdated = (data: {
    project_id: string;
    issue_id: string;
    changes: unknown;
  }) => {
    if (data.project_id !== projectId) return;
    const event: AdmiralEvent = {
      type: "issue.updated",
      projectId,
      timestamp: new Date(),
      data,
    };
    queueAndProcess(event).catch((err) => {
      logger.error(
        { err, projectId },
        "Admiral: Failed to queue issue.updated",
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
    const event: AdmiralEvent = {
      type: "issue.status_changed",
      projectId,
      timestamp: new Date(),
      data,
    };
    queueAndProcess(event).catch((err) => {
      logger.error(
        { err, projectId },
        "Admiral: Failed to queue issue.status_changed",
      );
    });
  };

  // Handler for agent run completion
  const handleRunCompleted = (data: {
    project_id: string;
    issue_id: string | null;
    agent_id: string;
    status: string;
  }) => {
    if (data.project_id !== projectId) return;
    const event: AdmiralEvent = {
      type: "run.completed",
      projectId,
      timestamp: new Date(),
      data,
    };
    queueAndProcess(event).catch((err) => {
      logger.error(
        { err, projectId },
        "Admiral: Failed to queue run.completed",
      );
    });
  };

  // Handler for PR status changes
  const handlePRStatusChanged = (data: {
    project_id: string;
    pr_id: string;
    from: string;
    to: string;
  }) => {
    if (data.project_id !== projectId) return;
    const event: AdmiralEvent = {
      type: "pr.status_changed",
      projectId,
      timestamp: new Date(),
      data,
    };
    queueAndProcess(event).catch((err) => {
      logger.error(
        { err, projectId },
        "Admiral: Failed to queue pr.status_changed",
      );
    });
  };

  // Handler for recovered runs (orphaned runs after server restart)
  const handleRunRecovered = (data: {
    project_id: string;
    issue_id: string;
    failed_agent_id: string;
  }) => {
    if (data.project_id !== projectId) return;
    const event: AdmiralEvent = {
      type: "run.recovered",
      projectId,
      timestamp: new Date(),
      data,
    };
    queueAndProcess(event).catch((err) => {
      logger.error(
        { err, projectId },
        "Admiral: Failed to queue run.recovered",
      );
    });
  };

  // Handler for comments (e.g. user requesting work on an issue)
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
    const event: AdmiralEvent = {
      type: "comment.added",
      projectId,
      timestamp: new Date(),
      data,
    };
    queueAndProcess(event).catch((err) => {
      logger.error(
        { err, projectId },
        "Admiral: Failed to queue comment.added",
      );
    });
  };

  // Handler for chat messages
  const handleChatMessage = (data: {
    project_id: string;
    content: string;
    images?: Array<{ data: string; mediaType: string }>;
  }) => {
    if (data.project_id !== projectId) return;
    const event: AdmiralEvent = {
      type: "chat.message",
      projectId,
      timestamp: new Date(),
      data,
      // Pass images through to the agent
      images: data.images,
    };
    queueAndProcess(event).catch((err) => {
      logger.error({ err, projectId }, "Admiral: Failed to queue chat.message");
    });
  };

  // Subscribe to all events
  eventBus.on("issue.created", handleIssueCreated);
  eventBus.on("issue.updated", handleIssueUpdated);
  eventBus.on("issue.status_changed", handleIssueStatusChanged);
  eventBus.on("run.completed", handleRunCompleted);
  eventBus.on("pr.status_changed", handlePRStatusChanged);
  eventBus.on("comment.added", handleCommentAdded);
  eventBus.on("chat.message", handleChatMessage);
  eventBus.on("run.recovered", handleRunRecovered);

  // Return unsubscribe function
  return () => {
    eventBus.off("issue.created", handleIssueCreated);
    eventBus.off("issue.updated", handleIssueUpdated);
    eventBus.off("issue.status_changed", handleIssueStatusChanged);
    eventBus.off("run.completed", handleRunCompleted);
    eventBus.off("pr.status_changed", handlePRStatusChanged);
    eventBus.off("comment.added", handleCommentAdded);
    eventBus.off("chat.message", handleChatMessage);
    eventBus.off("run.recovered", handleRunRecovered);

    // Clear idle timeout
    const timeout = idleTimeouts.get(projectId);
    if (timeout) {
      clearTimeout(timeout);
      idleTimeouts.delete(projectId);
    }
  };
}

/**
 * Start the Admiral service for a specific project.
 */
export function startAdmiralForProject(projectId: string): void {
  // Don't start if already running
  if (projectSubscriptions.has(projectId)) return;

  const project = getProject(projectId);
  if (!project?.captain_enabled) return;

  const unsubscribe = createProjectHandlers(projectId);
  projectSubscriptions.set(projectId, unsubscribe);

  // Initialize idle timeout if configured
  if (project.captain_idle_timeout_ms) {
    resetIdleTimeout(projectId);
  }

  logger.info({ projectId }, "Admiral service started for project");
}

/**
 * Stop the Admiral service for a specific project.
 */
export function stopAdmiralForProject(projectId: string): void {
  const unsubscribe = projectSubscriptions.get(projectId);
  if (unsubscribe) {
    unsubscribe();
    projectSubscriptions.delete(projectId);
    logger.info({ projectId }, "Admiral service stopped for project");
  }
}

/**
 * Initialize the Admiral service for all admiral-enabled projects.
 */
export function initAdmiralService(): void {
  const projects = listProjects().filter((p) => p.captain_enabled);

  for (const project of projects) {
    startAdmiralForProject(project.id);
  }

  logger.info({ projectCount: projects.length }, "Admiral service initialized");
}

/**
 * Shutdown all Admiral services.
 */
export function shutdownAdmiralService(): void {
  for (const [projectId, unsubscribe] of projectSubscriptions) {
    unsubscribe();
    logger.debug({ projectId }, "Admiral service stopped");
  }
  projectSubscriptions.clear();
  idleTimeouts.clear();

  logger.info("Admiral service shutdown complete");
}
