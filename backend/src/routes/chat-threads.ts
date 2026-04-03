/**
 * Chat Thread API Routes
 *
 * CRUD for chat threads and message sending endpoint that spawns
 * claude -p with session management.
 */
import { Router, type Request, type NextFunction, type Response } from "express";
import { verifyProject } from "../middleware/ownership.js";
import { NotFoundError, ValidationError } from "../middleware/errors.js";
import * as threadRepo from "../db/repositories/chat-threads.js";
import * as messageRepo from "../db/repositories/chat-messages.js";
import * as chatEventRepo from "../db/repositories/chat-message-events.js";
import type { ChatThread, ChatMessage } from "../types/entities.js";
import { acquireAndCreateMessage, runThreadSession, isThreadActive } from "../orchestration/chat-service.js";

const router = Router({ mergeParams: true });

type ProjectParams = { projectId: string };
type ThreadParams = ProjectParams & { threadId: string };

interface ThreadWithMeta extends ChatThread {
  last_message: string | null;
  message_count: number;
}

// POST /chat/threads — Create thread
router.post(
  "/chat/threads",
  verifyProject,
  (req: Request<ProjectParams>, res) => {
    const { title } = req.body as { title?: string };
    const thread = threadRepo.createThread(req.params.projectId, title);
    res.status(201).json(thread);
  },
);

// GET /chat/threads — List threads with message_count and last_message
router.get(
  "/chat/threads",
  verifyProject,
  (req: Request<ProjectParams>, res) => {
    const threads = threadRepo.listThreads(req.params.projectId);
    const enriched: ThreadWithMeta[] = threads.map((t) => {
      const lastMsg = messageRepo.getLastMessage(t.id);
      return {
        ...t,
        last_message: lastMsg?.content ?? null,
        message_count: messageRepo.getMessageCount(t.id),
      };
    });
    res.json(enriched);
  },
);

// GET /chat/threads/:threadId — Get thread + paginated messages
router.get(
  "/chat/threads/:threadId",
  verifyProject,
  (req: Request<ThreadParams>, res) => {
    const thread = threadRepo.getThread(req.params.threadId);
    if (!thread || thread.project_id !== req.params.projectId) {
      throw new NotFoundError("Thread not found");
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const messages = messageRepo.listMessages(thread.id, limit, offset);
    res.json({ ...thread, messages });
  },
);

// PATCH /chat/threads/:threadId — Update thread title
router.patch(
  "/chat/threads/:threadId",
  verifyProject,
  (req: Request<ThreadParams>, res) => {
    const thread = threadRepo.getThread(req.params.threadId);
    if (!thread || thread.project_id !== req.params.projectId) {
      throw new NotFoundError("Thread not found");
    }
    const { title, session_id } = req.body as { title?: string; session_id?: string | null };
    if (title === undefined && session_id === undefined) {
      throw new ValidationError("No fields to update");
    }
    const updated = threadRepo.updateThread(thread.id, {
      ...(title !== undefined ? { title } : {}),
      ...(session_id !== undefined ? { session_id } : {}),
    });
    res.json(updated);
  },
);

// DELETE /chat/threads/:threadId — Delete thread
router.delete(
  "/chat/threads/:threadId",
  verifyProject,
  (req: Request<ThreadParams>, res) => {
    const thread = threadRepo.getThread(req.params.threadId);
    if (!thread || thread.project_id !== req.params.projectId) {
      throw new NotFoundError("Thread not found");
    }
    messageRepo.deleteMessagesByThread(thread.id);
    threadRepo.deleteThread(thread.id);
    res.json({ deleted: true });
  },
);

// POST /chat/threads/:threadId/messages — Send message (fire-and-forget, 202)
router.post(
  "/chat/threads/:threadId/messages",
  verifyProject,
  (req: Request<ThreadParams>, res: Response, next: NextFunction) => {
    try {
      const thread = threadRepo.getThread(req.params.threadId);
      if (!thread || thread.project_id !== req.params.projectId) {
        throw new NotFoundError("Thread not found");
      }

      const { content } = req.body as { content?: string };
      if (!content || typeof content !== "string") {
        throw new ValidationError("Message content is required");
      }

      // Synchronously acquire lock and create user message.
      // Throws ConflictError (409) if already processing.
      const userMessageId = acquireAndCreateMessage(thread.id, content);

      // Respond immediately — the Claude session runs in a detached promise.
      res.status(202).json({ message_id: userMessageId });

      // Fire-and-forget: run the Claude session. Errors are logged and
      // emitted as chat.error + chat.complete inside runThreadSession.
      runThreadSession(thread.id, content).catch(() => {});
    } catch (err) {
      next(err);
    }
  },
);

// GET /chat/threads/:threadId/status — Check if thread is currently processing
router.get(
  "/chat/threads/:threadId/status",
  verifyProject,
  (req: Request<ThreadParams>, res) => {
    const thread = threadRepo.getThread(req.params.threadId);
    if (!thread || thread.project_id !== req.params.projectId) {
      throw new NotFoundError("Thread not found");
    }
    res.json({ active: isThreadActive(req.params.threadId) });
  },
);

// GET /chat/threads/:threadId/messages/:messageId/events — List events for a message
router.get(
  "/chat/threads/:threadId/messages/:messageId/events",
  verifyProject,
  (req: Request<ThreadParams & { messageId: string }>, res) => {
    const thread = threadRepo.getThread(req.params.threadId);
    if (!thread || thread.project_id !== req.params.projectId) {
      throw new NotFoundError("Thread not found");
    }
    const events = chatEventRepo.listEvents(req.params.messageId);
    res.json({ events });
  },
);

export default router;
