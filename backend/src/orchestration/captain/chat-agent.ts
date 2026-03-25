/**
 * Chat LLM Agent
 *
 * Handles interactive user conversations using `claude -p --output-format stream-json`.
 * Streams responses token-by-token to the frontend via WebSocket events.
 * Each message is a one-shot call with conversation history as context.
 */
import { logger } from "../../logger.js";
import { eventBus } from "../../events/bus.js";
import { getProject } from "../../db/repositories/projects.js";
import { getActiveProcessCount } from "../processes.js";
import { spawnClaudeStream, spawnClaudeMultimodal } from "../process.js";

import * as chatRepo from "../../db/repositories/chat-messages.js";
import type { CaptainEvent } from "./queue.js";

const MAX_CONTEXT_MESSAGES = 100;

/**
 * Build the system prompt for Chat — conversational and informational.
 */
const buildSystemPrompt = (projectId: string): string => {
  const project = getProject(projectId);
  if (!project) return "";

  const runningAgents = getActiveProcessCount(projectId);
  const canMerge = project.auto_merge_enabled;

  return `You are Captain, the project assistant for CrewDeck.

## Role
You have a conversation with the user about their project. You can answer questions,
provide status updates, and take actions on their behalf (dispatch agents, create issues, etc.).
A separate Monitor process handles automated orchestration events — you focus on the user's requests.

## Project: ${project.name}
${project.description || "No description"}

## Current Capacity
- Running agents: ${runningAgents}
- Max concurrency: ${project.max_concurrency}

## Available Actions
Use curl to call the CrewDeck internal API. Environment variables $CREWDECK_API_URL and $CREWDECK_PROJECT_ID are set.
${
  canMerge
    ? `
### Merge a PR
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/captain/merge-pr" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","issue_id":"<ISSUE_ID>"}'
\`\`\``
    : ""
}

### Dispatch an agent to work on an issue
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/captain/dispatch-agent" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","issue_id":"<ISSUE_ID>","agent_id":"<AGENT_ID>","instructions":"optional instructions"}'
\`\`\`
Available agents:
- \`engineer\` — writes and tests code
- \`lead\` — reviews code for correctness, security, architecture
- \`docs\` — updates documentation to match code changes
- \`librarian\` — investigates codebases, maintains knowledge entries

### Create an issue
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/issues/create" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","title":"Issue title","description":"Description"}'
\`\`\`

### Update an issue
\`\`\`bash
curl -X PATCH "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/<ISSUE_ID>" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"<new_status>","title":"optional new title"}'
\`\`\`

### Get issue details
\`\`\`bash
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/<ISSUE_ID>"
\`\`\`

### List issues
\`\`\`bash
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues"
\`\`\`

### Add a comment
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/comment" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","issue_id":"<ISSUE_ID>","agent_id":"captain","content":"Comment text"}'
\`\`\`

### Scan codebase (Librarian)
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/captain/scan-codebase" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'"}'
\`\`\`

### Knowledge Management
\`\`\`bash
# List
curl "$CREWDECK_API_URL/api/v1/internal/knowledge/list?project_id=$CREWDECK_PROJECT_ID"

# Create
curl -X POST "$CREWDECK_API_URL/api/v1/internal/knowledge/create" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","title":"Title","category":"architecture","content":"Content"}'

# Update
curl -X POST "$CREWDECK_API_URL/api/v1/internal/knowledge/update" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","knowledge_id":"<ID>","content":"Updated content"}'

# Delete
curl -X POST "$CREWDECK_API_URL/api/v1/internal/knowledge/delete" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","knowledge_id":"<ID>"}'
\`\`\`

## Response Style
- Be helpful and conversational
- Be concise — don't over-explain
- When you take actions, briefly explain why
- Use markdown for formatting${!canMerge ? "\n- You cannot merge PRs. Auto-merge is disabled for this project." : ""}`;
};

/**
 * Get chat conversation history from DB.
 * Only loads chat-type messages (not monitor event batches).
 */
const getChatHistory = (projectId: string): string => {
  const messages = chatRepo
    .getChatOnly(projectId, MAX_CONTEXT_MESSAGES)
    .reverse();
  if (messages.length === 0) return "";

  return messages
    .map((m) => {
      if (m.role === "user") {
        const imageNote =
          m.images && m.images.length > 0
            ? `\n[${m.images.length} image${m.images.length > 1 ? "s" : ""} attached]`
            : "";
        return `User:\n<user_message>\n${m.content}${imageNote}\n</user_message>`;
      }
      return `Captain: ${m.content}`;
    })
    .join("\n\n");
};

/**
 * Set up GitHub auth environment variables.
 */
const setupGitHubAuth = async (
  projectId: string,
  env: Record<string, string>,
): Promise<string | undefined> => {
  const project = getProject(projectId);
  if (!project?.github_account_id) return undefined;

  const { getGitHubAccount } =
    await import("../../db/repositories/github-accounts.js");
  const account = getGitHubAccount(project.github_account_id);
  if (!account) return undefined;

  env.GH_TOKEN = account.gh_token;
  const { createGitSshEnv } = await import("../../utils/git-auth.js");
  const ssh = createGitSshEnv(account.ssh_private_key);
  Object.assign(env, ssh.env);
  return ssh.keyPath;
};

/**
 * Process chat message with streaming LLM response.
 * Streams tokens to the frontend via chat.stream events.
 */
export const processChat = async (
  projectId: string,
  events: CaptainEvent[],
): Promise<string> => {
  const systemPrompt = buildSystemPrompt(projectId);
  if (!systemPrompt) return "Error: Project not found";

  // Process each chat.message event individually so none are dropped
  const chatEvents = events.filter((e) => e.type === "chat.message");
  if (chatEvents.length === 0) return "";

  let lastResponse = "";

  for (const chatEvent of chatEvents) {
    lastResponse = await processSingleChat(projectId, chatEvent, systemPrompt);
  }

  return lastResponse;
};

/**
 * Process a single chat message event.
 */
const processSingleChat = async (
  projectId: string,
  chatEvent: CaptainEvent,
  systemPrompt: string,
): Promise<string> => {
  const userContent = (chatEvent.data as { content: string }).content;
  const history = getChatHistory(projectId);
  const images = chatEvent.images ?? [];

  // Build prompt with history
  const sections = [];
  if (history) sections.push(`## Conversation History\n${history}`);
  sections.push(`## User Message\n${userContent}`);
  const userPrompt = sections.join("\n\n");

  // Emit thinking indicator
  eventBus.emit("captain.thinking", { project_id: projectId });

  const env: Record<string, string> = {
    CREWDECK_API_URL: `http://localhost:${process.env.PORT || "9381"}`,
    CREWDECK_PROJECT_ID: projectId,
    CREWDECK_AGENT_ID: "captain",
  };

  const sshKeyPath = await setupGitHubAuth(projectId, env);
  let fullResponse = "";

  try {
    if (images.length > 0) {
      // Multimodal path — uses non-streaming for image support
      const result = await spawnClaudeMultimodal({
        text: `## User Message\n${userContent}`,
        images,
        history: history || undefined,
        systemPrompt,
        workdir: ".",
        env,
      });
      const exitResult = await result.exitPromise;

      if (exitResult.code !== 0) {
        logger.warn(
          { projectId, code: exitResult.code },
          "Chat claude -p exited non-zero",
        );
      }

      // Parse JSON output
      try {
        const parsed = JSON.parse(exitResult.stdout);
        if (Array.isArray(parsed)) {
          const resultObj = parsed.find(
            (obj: { type: string }) => obj.type === "result",
          );
          fullResponse = resultObj?.result ?? exitResult.stdout;
        } else {
          fullResponse = parsed.result ?? exitResult.stdout;
        }
      } catch {
        fullResponse = exitResult.stdout;
      }

      // Emit the full response as a single message (no streaming for multimodal)
      if (fullResponse) {
        eventBus.emit("captain.message", {
          project_id: projectId,
          content: fullResponse,
        });
      }
    } else {
      // Streaming path — stream tokens to frontend
      const result = await spawnClaudeStream({
        prompt: userPrompt,
        systemPrompt,
        workdir: ".",
        env,
      });

      // Process stream events
      for await (const event of result.events) {
        switch (event.type) {
          case "assistant": {
            // Start of assistant turn — content blocks follow
            break;
          }
          case "content_block_start": {
            // New content block starting
            break;
          }
          case "content_block_delta": {
            const delta = event.delta as
              | { type: string; text?: string }
              | undefined;
            if (delta?.type === "text_delta" && delta.text) {
              fullResponse += delta.text;
              eventBus.emit("chat.stream", {
                project_id: projectId,
                token: delta.text,
              });
            }
            break;
          }
          case "content_block_stop": {
            // Content block finished
            break;
          }
          case "result": {
            // Final result — use as authoritative response
            const resultText = (event as { result?: string }).result;
            if (resultText) {
              fullResponse = resultText;
            }
            break;
          }
          default:
            // Other events (system, tool calls, etc.) — skip for now
            break;
        }
      }

      // Wait for process to exit
      const { code } = await result.exitPromise;
      if (code !== 0) {
        logger.warn({ projectId, code }, "Chat claude stream exited non-zero");
      }

      // Emit the full message for clients that missed the stream
      if (fullResponse) {
        eventBus.emit("captain.message", {
          project_id: projectId,
          content: fullResponse,
        });
      }
    }
  } catch (err) {
    logger.error({ err }, "Chat claude call failed");
    fullResponse = "Error: Failed to process message";
  } finally {
    if (sshKeyPath) {
      const { cleanupSshKey } = await import("../../utils/git-auth.js");
      cleanupSshKey(sshKeyPath);
    }
  }

  // Save assistant response to DB
  if (fullResponse) {
    chatRepo.create(projectId, "assistant", fullResponse, "chat");
  }

  // Emit completion
  const messageId = null; // Message already saved inline
  eventBus.emit("chat.complete", {
    project_id: projectId,
    message_id: messageId,
  });

  return fullResponse;
};
