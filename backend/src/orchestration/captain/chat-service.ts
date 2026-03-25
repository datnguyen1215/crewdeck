/**
 * Chat Service
 *
 * Handles interactive user conversations. Subscribes to chat.message events,
 * enforces per-session concurrency (one in-flight message per session), and
 * processes through the Chat LLM agent with streaming output.
 *
 * Also handles chat.abort events to kill in-flight processes.
 */
import { eventBus } from "../../events/bus.js";
import { logger } from "../../logger.js";
import { getProject, listProjects } from "../../db/repositories/projects.js";
import { processChat, isSessionBusy, abortSession } from "./chat-agent.js";
import type { CaptainEvent } from "./queue.js";

const projectSubscriptions = new Map<string, () => void>();

/**
 * Process a single chat message for a session.
 * Per-session concurrency: rejects if session already has an in-flight message.
 */
async function handleChatEvent(event: CaptainEvent): Promise<void> {
  const { projectId } = event;
  const sessionId = (event.data as { session_id?: string }).session_id;

  if (!sessionId) {
    logger.warn({ projectId }, "Chat: Ignoring message without session_id");
    return;
  }

  // Per-session concurrency: reject if session already busy
  if (isSessionBusy(sessionId)) {
    logger.warn(
      { projectId, sessionId },
      "Chat: Rejecting message — session has in-flight message",
    );
    return;
  }

  logger.info({ projectId, sessionId }, "Chat: Processing message");

  try {
    await processChat(projectId, [event]);
  } catch (err) {
    logger.error(
      { err, projectId, sessionId },
      "Chat: Failed to process message",
    );
  }
}

/**
 * Create chat event handlers for a project.
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
    handleChatEvent(event).catch((err) => {
      logger.error({ err, projectId }, "Chat: Failed to handle chat.message");
    });
  };

  const handleAbort = (data: { project_id: string; session_id: string }) => {
    if (data.project_id !== projectId) return;
    const aborted = abortSession(data.session_id);
    if (aborted) {
      logger.info(
        { projectId, sessionId: data.session_id },
        "Chat: Aborted in-flight message",
      );
    }
  };

  eventBus.on("chat.message", handleChatMessage);
  eventBus.on("chat.abort", handleAbort);

  return () => {
    eventBus.off("chat.message", handleChatMessage);
    eventBus.off("chat.abort", handleAbort);
  };
}

export function startChatForProject(projectId: string): void {
  if (projectSubscriptions.has(projectId)) return;

  const project = getProject(projectId);
  if (!project) return;

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
  const projects = listProjects();
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
