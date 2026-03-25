/**
 * Chat Session API Routes
 *
 * Session-based conversational interface to the Captain.
 * Each project can have one active session at a time.
 */
import { Router, type Request } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { verifyProject } from "../middleware/ownership.js";
import { getProject } from "../db/repositories/projects.js";
import * as sessionRepo from "../db/repositories/chat-sessions.js";
import {
  createWithId as createChatMessageWithId,
  getBySession as getMessagesBySession,
  deleteByProject as deleteChatMessages,
} from "../db/repositories/chat-messages.js";
import { eventBus } from "../events/bus.js";
import { logger } from "../logger.js";
import { saveImages } from "../utils/image-storage.js";

const router = Router({ mergeParams: true });

const CreateSessionSchema = z.object({
  title: z.string().max(200).optional(),
});

const ImageSchema = z.object({
  data: z.string(),
  mediaType: z.string(),
});

const SendMessageSchema = z.object({
  message: z.string().min(1).max(10000),
  images: z.array(ImageSchema).optional(),
});

type ProjectParams = { projectId: string };
type SessionParams = { projectId: string; sessionId: string };

// GET /chat/sessions — list sessions (newest first)
router.get(
  "/chat/sessions",
  verifyProject,
  (req: Request<ProjectParams>, res) => {
    const sessions = sessionRepo.listByProject(req.params.projectId);
    res.json(sessions);
  },
);

// POST /chat/sessions — create a new session (archives current active one)
router.post(
  "/chat/sessions",
  verifyProject,
  validate(CreateSessionSchema),
  (req: Request<ProjectParams>, res) => {
    const { title } = req.body;
    const session = sessionRepo.create(req.params.projectId, title);
    res.status(201).json(session);
  },
);

// GET /chat/sessions/:sessionId/messages — get session messages
router.get(
  "/chat/sessions/:sessionId/messages",
  verifyProject,
  (req: Request<SessionParams>, res) => {
    const { projectId, sessionId } = req.params;
    const session = sessionRepo.getById(sessionId);
    if (!session || session.project_id !== projectId) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: "Session not found" },
      });
      return;
    }
    const messages = getMessagesBySession(sessionId);
    res.json(messages);
  },
);

// POST /chat/sessions/:sessionId/messages — send a message (triggers claude -p)
router.post(
  "/chat/sessions/:sessionId/messages",
  verifyProject,
  validate(SendMessageSchema),
  (req: Request<SessionParams>, res) => {
    const { projectId, sessionId } = req.params;
    const { message, images } = req.body;

    const session = sessionRepo.getById(sessionId);
    if (!session || session.project_id !== projectId) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: "Session not found" },
      });
      return;
    }

    if (session.status === "archived") {
      res.status(400).json({
        error: {
          code: "SESSION_ARCHIVED",
          message: "Cannot add messages to an archived session",
        },
      });
      return;
    }

    const project = getProject(projectId);
    if (!project) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: "Project not found" },
      });
      return;
    }

    // Generate message ID upfront for image storage
    const messageId = crypto.randomUUID();

    // Save images to disk if present
    let imagePaths: string[] | null = null;
    if (images && images.length > 0) {
      imagePaths = saveImages(projectId, messageId, images);
    }

    // Save user message to DB
    const userMessage = createChatMessageWithId(
      messageId,
      projectId,
      "user",
      message,
      sessionId,
      imagePaths,
    );

    // Emit chat.message event for Captain — response comes via WebSocket
    eventBus.emit("chat.message", {
      project_id: projectId,
      session_id: sessionId,
      content: message,
      images: images,
    });

    logger.info(
      {
        projectId,
        sessionId,
        messageId: userMessage.id,
        imageCount: images?.length ?? 0,
      },
      "Chat message queued for Captain",
    );

    // Return immediately — response delivered via WebSocket events
    res.status(202).json({
      user_message: userMessage,
      status: "queued",
    });
  },
);

// DELETE /chat — Clear all chat history for project (kept for backward compat)
router.delete("/chat", verifyProject, (req: Request<ProjectParams>, res) => {
  deleteChatMessages(req.params.projectId);
  res.status(204).send();
});

export default router;
