/**
 * Admiral Chat API Routes
 *
 * Provides conversational interface to the Admiral for project management.
 * User messages are queued as events for the event-driven Admiral to process.
 */
import { Router, type Request } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { verifyProject } from "../middleware/ownership.js";
import { getProject } from "../db/repositories/projects.js";
import {
  createWithId as createChatMessageWithId,
  getByProject as getChatMessages,
  deleteByProject as deleteChatMessages,
} from "../db/repositories/chat-messages.js";
import { eventBus } from "../events/bus.js";
import { logger } from "../logger.js";
import { saveImages } from "../utils/image-storage.js";

const router = Router({ mergeParams: true });

const ImageSchema = z.object({
  data: z.string(),
  mediaType: z.string(),
});

const SendMessageSchema = z.object({
  message: z.string().min(1).max(10000),
  images: z.array(ImageSchema).optional(),
});

// GET /chat - Get chat history
router.get("/chat", verifyProject, (req: Request<{ projectId: string }>, res) => {
  const { projectId } = req.params;
  // Return messages in chronological order (oldest first)
  const messages = getChatMessages(projectId, 100).reverse();
  res.json(messages);
});

// POST /chat - Send a message to Admiral
router.post(
  "/chat",
  verifyProject,
  validate(SendMessageSchema),
  (req: Request<{ projectId: string }>, res) => {
    const { projectId } = req.params;
    const { message, images } = req.body;

    const project = getProject(projectId);
    if (!project) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
      return;
    }

    // Generate message ID upfront for image storage
    const messageId = crypto.randomUUID();

    // Save images to disk if present
    let imagePaths: string[] | null = null;
    if (images && images.length > 0) {
      imagePaths = saveImages(projectId, messageId, images);
    }

    // Save user message to DB (for history)
    const userMessage = createChatMessageWithId(
      messageId,
      projectId,
      "user",
      message,
      "chat",
      imagePaths
    );

    // Emit chat.message event for Admiral queue - response comes via WebSocket
    // Include base64 images for Admiral to process (paths stored in DB, base64 sent to LLM)
    eventBus.emit("chat.message", {
      project_id: projectId,
      content: message,
      images: images,
    });

    logger.info(
      { projectId, messageId: userMessage.id, imageCount: images?.length ?? 0 },
      "Chat message queued for Admiral"
    );

    // Return immediately - response delivered via WebSocket events
    res.status(202).json({
      user_message: userMessage,
      status: "queued",
    });
  }
);

// DELETE /chat - Clear chat history
router.delete("/chat", verifyProject, (req: Request<{ projectId: string }>, res) => {
  const { projectId } = req.params;
  deleteChatMessages(projectId);
  res.status(204).send();
});

export default router;
