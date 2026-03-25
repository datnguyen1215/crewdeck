/**
 * Chat LLM Agent
 *
 * Handles interactive user conversations using `claude -p --output-format stream-json`.
 * Streams responses token-by-token to the frontend via WebSocket events.
 * Each message is a one-shot call with conversation history as context.
 *
 * Supports:
 * - Streaming text chunks via captain.chat.chunk
 * - Tool call/result events via captain.chat.tool_call / captain.chat.tool_result
 * - 10-minute timeout with SIGTERM -> SIGKILL escalation
 * - Abort handling via chat.abort events (kills in-flight process)
 * - Per-session concurrency (one in-flight message per session)
 */
import { type ChildProcess } from "node:child_process";
import { logger } from "../../logger.js";
import { eventBus } from "../../events/bus.js";
import { getProject } from "../../db/repositories/projects.js";
import { getActiveProcessCount } from "../processes.js";
import { spawnClaudeStream, spawnClaudeMultimodal } from "../process.js";

import * as chatRepo from "../../db/repositories/chat-messages.js";
import type { CaptainEvent } from "./queue.js";

const MAX_CONTEXT_MESSAGES = 100;
const CHAT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const KILL_ESCALATION_MS = 5000; // SIGTERM -> SIGKILL delay

/** Tracks in-flight chat processes per session for abort support */
interface InFlightChat {
  process: ChildProcess | null; // null while pending (process not yet spawned)
  pid: number | null;
  aborted: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const inFlightSessions = new Map<string, InFlightChat>();

/**
 * Check if a session has an in-flight message being processed.
 */
export const isSessionBusy = (sessionId: string): boolean =>
  inFlightSessions.has(sessionId);

/**
 * Abort an in-flight chat process for a session.
 * Sends SIGTERM, then SIGKILL after 5s if still alive.
 * Does not save partial response to DB.
 */
export const abortSession = (sessionId: string): boolean => {
  const flight = inFlightSessions.get(sessionId);
  if (!flight) return false;

  flight.aborted = true;
  logger.info({ sessionId, pid: flight.pid }, "Aborting chat process");

  // Process may be null if still in pending state (not yet spawned)
  if (flight.process) {
    try {
      flight.process.kill("SIGTERM");
    } catch {
      /* already dead */
    }

    const proc = flight.process;
    setTimeout(() => {
      try {
        if (!proc.killed) proc.kill("SIGKILL");
      } catch {
        /* already dead */
      }
    }, KILL_ESCALATION_MS);
  }

  return true;
};

/**
 * Build the system prompt for Chat -- conversational and informational.
 */
const buildSystemPrompt = (projectId: string): string => {
  const project = getProject(projectId);
  if (!project) return "";

  const runningAgents = getActiveProcessCount(projectId);
  const canMerge = project.auto_merge;

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
 * Get chat conversation history from DB for the given session.
 */
const getChatHistory = (sessionId: string): string => {
  const messages = chatRepo.getBySession(sessionId, MAX_CONTEXT_MESSAGES);
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
 * Reserve a session slot synchronously before any async work.
 * Prevents race conditions where two requests pass isSessionBusy() checks
 * before either has spawned a process.
 */
function reserveSession(sessionId: string): InFlightChat {
  const flight: InFlightChat = {
    process: null,
    pid: null,
    aborted: false,
    timer: null,
  };
  inFlightSessions.set(sessionId, flight);
  return flight;
}

/**
 * Register an in-flight process for an already-reserved session. Sets up timeout.
 */
function trackProcess(
  sessionId: string,
  childProcess: ChildProcess,
  pid: number,
): void {
  const flight = inFlightSessions.get(sessionId);
  if (!flight) return;

  flight.process = childProcess;
  flight.pid = pid;

  // If abort was requested while we were in the pending state (process not yet spawned),
  // kill the newly-spawned process immediately and skip timeout setup
  if (flight.aborted) {
    logger.info(
      { sessionId, pid },
      "Process spawned after abort — killing immediately",
    );
    try {
      childProcess.kill("SIGTERM");
    } catch {
      /* already dead */
    }
    setTimeout(() => {
      try {
        if (!childProcess.killed) childProcess.kill("SIGKILL");
      } catch {
        /* already dead */
      }
    }, KILL_ESCALATION_MS);
    return;
  }

  flight.timer = setTimeout(() => {
    const current = inFlightSessions.get(sessionId);
    if (!current) return;
    current.aborted = true;
    logger.warn({ sessionId, pid }, "Chat process timed out (10 min)");
    try {
      childProcess.kill("SIGTERM");
    } catch {
      /* already dead */
    }
    setTimeout(() => {
      try {
        if (!childProcess.killed) childProcess.kill("SIGKILL");
      } catch {
        /* already dead */
      }
    }, KILL_ESCALATION_MS);
  }, CHAT_TIMEOUT_MS);
}

/**
 * Clean up in-flight tracking for a session.
 */
function untrackProcess(sessionId: string): void {
  const flight = inFlightSessions.get(sessionId);
  if (flight) {
    if (flight.timer) clearTimeout(flight.timer);
    inFlightSessions.delete(sessionId);
  }
}

/**
 * Process chat message with streaming LLM response.
 * Streams tokens to the frontend via captain.chat.chunk events.
 */
export const processChat = async (
  projectId: string,
  events: CaptainEvent[],
): Promise<string> => {
  const systemPrompt = buildSystemPrompt(projectId);
  if (!systemPrompt) return "Error: Project not found";

  const chatEvents = events.filter((e) => e.type === "chat.message");
  if (chatEvents.length === 0) return "";

  let lastResponse = "";

  for (const chatEvent of chatEvents) {
    const sessionId = (chatEvent.data as { session_id?: string }).session_id;
    lastResponse = await processSingleChat(
      projectId,
      chatEvent,
      systemPrompt,
      sessionId,
    );
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
  sessionId?: string,
): Promise<string> => {
  const userContent = (chatEvent.data as { content: string }).content;
  const history = sessionId ? getChatHistory(sessionId) : "";
  const images = chatEvent.images ?? [];

  // Reserve session slot synchronously before any async work to prevent
  // race conditions with concurrent requests
  let flight: InFlightChat | undefined;
  if (sessionId) {
    if (isSessionBusy(sessionId)) {
      logger.warn({ projectId, sessionId }, "Chat: Session already reserved");
      return "";
    }
    flight = reserveSession(sessionId);
  }

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
      // Multimodal path -- uses non-streaming for image support
      const result = await spawnClaudeMultimodal({
        text: `## User Message\n${userContent}`,
        images,
        history: history || undefined,
        systemPrompt,
        workdir: ".",
        env,
      });

      if (sessionId) {
        trackProcess(sessionId, result.process, result.pid!);
      }

      const exitResult = await result.exitPromise;

      if (flight?.aborted) {
        logger.info(
          { projectId, sessionId },
          "Chat aborted, discarding response",
        );
        return "";
      }

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

      // Emit the full response as a single chunk (no streaming for multimodal)
      if (fullResponse && sessionId) {
        eventBus.emit("captain.chat.chunk", {
          project_id: projectId,
          session_id: sessionId,
          text: fullResponse,
        });
      }
      if (fullResponse) {
        eventBus.emit("captain.message", {
          project_id: projectId,
          content: fullResponse,
        });
      }
    } else {
      // Streaming path -- stream tokens to frontend
      const result = await spawnClaudeStream({
        prompt: userPrompt,
        systemPrompt,
        workdir: ".",
        env,
      });

      if (sessionId) {
        trackProcess(sessionId, result.process, result.pid);
      }

      // Track current tool name for pairing tool_call with tool_result
      let currentToolName = "";

      // Process stream events
      for await (const event of result.events) {
        // Check if aborted between events
        if (flight?.aborted) break;

        switch (event.type) {
          case "assistant": {
            break;
          }
          case "content_block_start": {
            // Track tool use blocks
            const contentBlock = event.content_block as
              | { type: string; name?: string }
              | undefined;
            if (contentBlock?.type === "tool_use" && contentBlock.name) {
              currentToolName = contentBlock.name;
            }
            break;
          }
          case "content_block_delta": {
            const delta = event.delta as
              | { type: string; text?: string; partial_json?: string }
              | undefined;
            if (delta?.type === "text_delta" && delta.text) {
              fullResponse += delta.text;
              // Emit both legacy and new events
              eventBus.emit("chat.stream", {
                project_id: projectId,
                token: delta.text,
              });
              if (sessionId) {
                eventBus.emit("captain.chat.chunk", {
                  project_id: projectId,
                  session_id: sessionId,
                  text: delta.text,
                });
              }
            }
            break;
          }
          case "content_block_stop": {
            break;
          }
          // Tool use events from Claude CLI stream-json
          case "tool_use": {
            const toolName = (event as any).name ?? currentToolName;
            const toolInput = (event as any).input;
            if (sessionId) {
              eventBus.emit("captain.chat.tool_call", {
                project_id: projectId,
                session_id: sessionId,
                tool_name: toolName,
                tool_input: toolInput,
              });
            }
            currentToolName = toolName;
            break;
          }
          case "tool_result": {
            const toolResult = (event as any).content ?? (event as any).output;
            if (sessionId) {
              eventBus.emit("captain.chat.tool_result", {
                project_id: projectId,
                session_id: sessionId,
                tool_name: currentToolName,
                result: toolResult,
              });
            }
            break;
          }
          case "result": {
            // Final result -- use as authoritative response
            const resultText = (event as { result?: string }).result;
            if (resultText) {
              fullResponse = resultText;
            }
            break;
          }
          default:
            break;
        }
      }

      // Wait for process to exit
      const { code } = await result.exitPromise;

      if (flight?.aborted) {
        logger.info(
          { projectId, sessionId },
          "Chat aborted, discarding response",
        );
        return "";
      }

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
    if (flight?.aborted) {
      logger.info({ projectId, sessionId }, "Chat aborted during processing");
      return "";
    }
    logger.error({ err }, "Chat claude call failed");
    fullResponse = "Error: Failed to process message";
  } finally {
    if (sessionId) untrackProcess(sessionId);
    if (sshKeyPath) {
      const { cleanupSshKey } = await import("../../utils/git-auth.js");
      cleanupSshKey(sshKeyPath);
    }
  }

  // Save assistant response to DB (skip if aborted or empty)
  let messageId: string | null = null;
  if (fullResponse) {
    const saved = chatRepo.create(
      projectId,
      "assistant",
      fullResponse,
      sessionId ?? null,
    );
    messageId = saved.id;
  }

  // Emit completion events
  eventBus.emit("chat.complete", {
    project_id: projectId,
    message_id: messageId,
  });

  if (sessionId && messageId) {
    eventBus.emit("captain.chat.complete", {
      project_id: projectId,
      session_id: sessionId,
      message_id: messageId,
    });
  }

  return fullResponse;
};
