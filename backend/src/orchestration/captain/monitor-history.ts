/**
 * Monitor conversation history retrieval.
 */
import * as chatRepo from "../../db/repositories/chat-messages.js";

const MAX_CONTEXT_MESSAGES = 10;

/**
 * Get monitor conversation history from DB.
 * Monitor messages are stored without a session_id.
 */
export const getMonitorHistory = (projectId: string): string => {
  const messages = chatRepo
    .getByProject(projectId, MAX_CONTEXT_MESSAGES)
    .reverse();
  if (messages.length === 0) return "";

  return messages
    .map((m: { role: string; content: string }) => {
      if (m.role === "user") return `Event batch:\n${m.content}`;
      return `Monitor response: ${m.content}`;
    })
    .join("\n\n");
};
