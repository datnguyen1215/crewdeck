/**
 * Admiral Chat API Routes
 *
 * Provides conversational interface to the Admiral for project management.
 * Bypasses agent concurrency limits - chat always works regardless of agent load.
 */
import { Router, type Request } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { verifyProject } from "../middleware/ownership.js";
import { getProject } from "../db/repositories/projects.js";
import {
  create as createChatMessage,
  getByProject as getChatMessages,
  deleteByProject as deleteChatMessages,
} from "../db/repositories/chat-messages.js";
import { listRepos } from "../db/repositories/repos.js";
import {
  ADMIRAL_CHAT_SYSTEM_PROMPT,
  buildAdmiralChatPrompt,
} from "../orchestration/admiral-chat-prompt.js";
import { spawnClaudeStream } from "../orchestration/process.js";
import { eventBus } from "../events/bus.js";
import { logger } from "../logger.js";
import type { ChatMessage } from "../types/entities.js";

const router = Router({ mergeParams: true });

const SendMessageSchema = z.object({
  message: z.string().min(1).max(10000),
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
  async (req: Request<{ projectId: string }>, res) => {
    const { projectId } = req.params;
    const { message } = req.body;

    const project = getProject(projectId);
    if (!project) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
      return;
    }

    // Save user message
    const userMessage = createChatMessage(projectId, "user", message);

    // Build prompt with context
    const prompt = buildAdmiralChatPrompt({
      project,
      userMessage: message,
    });

    // Prepare environment
    const env: Record<string, string> = {
      CREWDECK_API_URL: `http://localhost:${process.env.PORT || "9381"}`,
      CREWDECK_PROJECT_ID: projectId,
    };

    // Get project repo path for filesystem access
    const repos = listRepos(projectId);
    const workdir = repos.length > 0 ? repos[0].local_path : ".";

    // Spawn Claude process (does NOT count against concurrency)
    try {
      const result = await spawnClaudeStream({
        prompt,
        systemPrompt: ADMIRAL_CHAT_SYSTEM_PROMPT,
        workdir,
        env,
      });

      logger.info({ pid: result.pid, projectId }, "Admiral chat spawned");

      // Immediately return user message ID (response streams via WebSocket)
      res.status(202).json({
        user_message: userMessage,
        status: "streaming",
      });

      // Process stream in background
      processAdmiralStream(result, projectId).catch((err) => {
        logger.error({ err, projectId }, "Error processing admiral chat stream");
        // Emit error completion so frontend doesn't stay stuck
        eventBus.emit("chat.complete", { project_id: projectId, message_id: null });
      });
    } catch (err) {
      logger.error({ err, projectId }, "Failed to spawn admiral chat");
      res.status(500).json({
        error: { code: "SPAWN_FAILED", message: "Failed to start chat" },
      });
    }
  }
);

// DELETE /chat - Clear chat history
router.delete("/chat", verifyProject, (req: Request<{ projectId: string }>, res) => {
  const { projectId } = req.params;
  deleteChatMessages(projectId);
  res.status(204).send();
});

/**
 * Process streaming output from Admiral and broadcast via WebSocket.
 */
async function processAdmiralStream(
  result: Awaited<ReturnType<typeof spawnClaudeStream>>,
  projectId: string
): Promise<void> {
  let fullResponse = "";

  for await (const event of result.events) {
    // Extract text content from assistant_text events
    if (event.type === "assistant_text") {
      const text = (event as any).text ?? "";
      if (text) {
        fullResponse += text;
        eventBus.emit("chat.stream", { project_id: projectId, token: text });
      }
    }

    // Handle result event (final content)
    if (event.type === "result") {
      const resultText = (event as any).result ?? "";
      if (resultText && !fullResponse) {
        fullResponse = resultText;
      }
    }
  }

  // Wait for process exit
  const { code } = await result.exitPromise;

  if (code !== 0) {
    logger.error({ code, projectId }, "Admiral chat process failed");
    fullResponse = fullResponse || "I encountered an error processing your request. Please try again.";
  }

  // Save assistant response (skip if empty)
  if (!fullResponse.trim()) {
    logger.warn({ projectId }, "Admiral returned empty response, skipping save");
    eventBus.emit("chat.complete", { project_id: projectId, message_id: null });
    return;
  }

  const assistantMessage = createChatMessage(projectId, "assistant", fullResponse);

  // Emit completion event
  eventBus.emit("chat.complete", {
    project_id: projectId,
    message_id: assistantMessage.id,
  });

  logger.info({ projectId, messageId: assistantMessage.id }, "Admiral chat completed");
}

export default router;
