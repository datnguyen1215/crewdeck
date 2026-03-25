/**
 * Chat Service
 *
 * Handles interactive user conversations. Subscribes to chat.message events,
 * queues them, and processes through the Chat LLM agent with streaming output.
 * Runs independently from the Monitor service.
 */
import { eventBus } from "../../events/bus.js";
import { logger } from "../../logger.js";
import { getProject, listProjects } from "../../db/repositories/projects.js";
import { enqueue, tryAcquire, release, drain, hasPending } from "./queue.js";
import { processChat } from "./chat-agent.js";
import type { CaptainEvent } from "./queue.js";

// Queue namespace prefix to separate chat from monitor queues
const CHAT_PREFIX = "chat:";

const projectSubscriptions = new Map<string, () => void>();

/**
 * Queue a chat event and trigger processing if not already running.
 */
async function queueAndProcess(event: CaptainEvent): Promise<void> {
  const { projectId } = event;
  const queueKey = `${CHAT_PREFIX}${projectId}`;

  const project = getProject(projectId);
  if (!project?.captain_enabled) return;

  enqueue({ ...event, projectId: queueKey });

  if (!tryAcquire(queueKey)) {
    logger.debug({ projectId }, "Chat: Message queued while processing");
    return;
  }

  try {
    await processQueue(projectId, queueKey);
  } finally {
    release(queueKey);
  }
}

/**
 * Process all pending chat messages in the queue.
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
      { projectId, messageCount: events.length },
      "Chat: Processing messages",
    );

    try {
      await processChat(projectId, events);
    } catch (err) {
      logger.error({ err, projectId }, "Chat: Failed to process messages");
    }
  }
}

/**
 * Create chat event handler for a project.
 */
function createProjectHandler(projectId: string): () => void {
  const handleChatMessage = (data: {
    project_id: string;
    session_id: string;
    content: string;
    images?: Array<{ data: string; mediaType: string }>;
  }) => {
    if (data.project_id !== projectId) return;
    const event: CaptainEvent = {
      type: "chat.message",
      projectId,
      timestamp: new Date(),
      data,
      images: data.images,
    };
    queueAndProcess(event).catch((err) => {
      logger.error({ err, projectId }, "Chat: Failed to queue chat.message");
    });
  };

  eventBus.on("chat.message", handleChatMessage);

  return () => {
    eventBus.off("chat.message", handleChatMessage);
  };
}

export function startChatForProject(projectId: string): void {
  if (projectSubscriptions.has(projectId)) return;

  const project = getProject(projectId);
  if (!project?.captain_enabled) return;

  const unsubscribe = createProjectHandler(projectId);
  projectSubscriptions.set(projectId, unsubscribe);

  logger.info({ projectId }, "Chat service started for project");
}

export function stopChatForProject(projectId: string): void {
  const unsubscribe = projectSubscriptions.get(projectId);
  if (unsubscribe) {
    unsubscribe();
    projectSubscriptions.delete(projectId);
    logger.info({ projectId }, "Chat service stopped for project");
  }
}

export function initChatService(): void {
  const projects = listProjects().filter((p) => p.captain_enabled);
  for (const project of projects) {
    startChatForProject(project.id);
  }
  logger.info({ projectCount: projects.length }, "Chat service initialized");
}

export function shutdownChatService(): void {
  for (const [projectId, unsubscribe] of projectSubscriptions) {
    unsubscribe();
    logger.debug({ projectId }, "Chat service stopped");
  }
  projectSubscriptions.clear();
  logger.info("Chat service shutdown complete");
}
