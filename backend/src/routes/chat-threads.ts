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
import type { ChatThread, ChatMessage } from "../types/entities.js";
import { sendMessage } from "../orchestration/chat-service.js";

const router = Router({ mergeParams: true });

type ProjectParams = { projectId: string };
type ThreadParams = ProjectParams & { threadId: string };

interface ThreadWithMeta extends ChatThread {
  last_message: ChatMessage | null;
  message_count: number;
}

// POST /chat/threads — Create thread
router.post(
  "/chat/threads",
  verifyProject,
  (req: Request<ProjectParams>, res) => {
    const { title, type } = req.body as {
      title?: string;
      type?: "user" | "monitor";
    };
    const threadType = type ?? "user";
    if (threadType !== "user" && threadType !== "monitor") {
      throw new ValidationError("Invalid thread type", { type });
    }
    const thread = threadRepo.createThread(req.params.projectId, threadType, title);
    res.status(201).json(thread);
  },
);

// GET /chat/threads — List threads with message_count and last_message
router.get(
  "/chat/threads",
  verifyProject,
  (req: Request<ProjectParams>, res) => {
    const threads = threadRepo.listThreads(req.params.projectId);
    const enriched: ThreadWithMeta[] = threads.map((t) => ({
      ...t,
      last_message: messageRepo.getLastMessage(t.id),
      message_count: messageRepo.getMessageCount(t.id),
    }));
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
    const { title } = req.body as { title?: string };
    if (title === undefined) {
      throw new ValidationError("No fields to update");
    }
    const updated = threadRepo.updateThread(thread.id, { title });
    res.json(updated);
  },
);

// DELETE /chat/threads/:threadId — Delete thread (not monitor type)
router.delete(
  "/chat/threads/:threadId",
  verifyProject,
  (req: Request<ThreadParams>, res) => {
    const thread = threadRepo.getThread(req.params.threadId);
    if (!thread || thread.project_id !== req.params.projectId) {
      throw new NotFoundError("Thread not found");
    }
    if (thread.type === "monitor") {
      throw new ValidationError("Cannot delete monitor threads");
    }
    messageRepo.deleteMessagesByThread(thread.id);
    threadRepo.deleteThread(thread.id);
    res.json({ deleted: true });
  },
);

// POST /chat/threads/:threadId/messages — Send message and stream Claude response
router.post(
  "/chat/threads/:threadId/messages",
  verifyProject,
  async (req: Request<ThreadParams>, res: Response, next: NextFunction) => {
    try {
      const thread = threadRepo.getThread(req.params.threadId);
      if (!thread || thread.project_id !== req.params.projectId) {
        throw new NotFoundError("Thread not found");
      }

      const { content } = req.body as { content?: string };
      if (!content || typeof content !== "string") {
        throw new ValidationError("Message content is required");
      }

      const result = await sendMessage(thread.id, content);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
