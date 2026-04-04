/**
 * Chat Service
 *
 * Handles Claude session lifecycle for chat threads. Spawns claude -p with
 * --resume for persistent sessions, streams events via the event bus.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { logger } from "../logger.js";
import { eventBus } from "../events/bus.js";
import { buildProviderEnv } from "./provider-env.js";
import { buildSystemPrompt as buildCaptainPrompt } from "./captain-prompt.js";
import { setupGitHubAuth } from "./captain-worktree.js";
import { cleanupSshKey } from "../utils/git-auth.js";
import { spawnClaude } from "./process.js";
import { resolveModel } from "../db/repositories/agent-config.js";
import {
  getThread,
  updateThread,
} from "../db/repositories/chat-threads.js";
import {
  createMessage,
  updateMessage,
  deleteMessage,
} from "../db/repositories/chat-messages.js";
import * as chatEventRepo from "../db/repositories/chat-message-events.js";
import { listRepos } from "../db/repositories/repos.js";
import * as globalEnvVarRepo from "../db/repositories/global-environment-variables.js";
import { getEnvironmentVariablesMap } from "../db/repositories/environment-variables.js";
import { getSystemApiKey } from "../app.js";
import { ConflictError } from "../middleware/errors.js";
import { normalizeEvent } from "../services/event-normalizer.js";

// In-memory lock: only one claude -p process per thread at a time
const activeThreads = new Map<string, boolean>();

export function isThreadActive(threadId: string): boolean {
  return activeThreads.get(threadId) ?? false;
}

interface ChatServiceResult {
  message_id: string;
  session_id: string | null;
}

/**
 * Acquire the per-thread lock and create the user message synchronously.
 * Returns the user message ID for the immediate HTTP 202 response.
 *
 * IMPORTANT: The isThreadActive check + set below are safe from TOCTOU races
 * only because there is no `await` (yield point) between them. Node.js is
 * single-threaded, so no other code can interleave between the check and set.
 * Do NOT insert an `await` between these two lines without adding a proper mutex.
 */
export function acquireAndCreateMessage(
  threadId: string,
  content: string,
): string {
  if (isThreadActive(threadId)) {
    throw new ConflictError("A message is already being processed for this thread");
  }

  const thread = getThread(threadId);
  if (!thread) throw new Error(`Thread ${threadId} not found`);

  const userMsg = createMessage(threadId, "user", content);

  // Set lock only after message is persisted — avoids permanent lock on DB error
  activeThreads.set(threadId, true);
  return userMsg.id;
}

/**
 * Run the Claude session for a thread that already has a lock acquired.
 * Call this after acquireAndCreateMessage in a detached promise.
 * Emits chat.error and chat.complete on failure; chat.complete on success.
 */
export async function runThreadSession(threadId: string, content: string): Promise<void> {
  let thread: NonNullable<ReturnType<typeof getThread>> | null = null;
  let assistantMsgId: string | null = null;
  try {
    thread = getThread(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    const result = await runClaudeSession(thread, content);
    assistantMsgId = result.message_id;
  } catch (err) {
    // If thread wasn't fetched yet (getThread threw), try once more for event context
    thread = thread ?? getThread(threadId);
    if (!thread) return; // Thread gone — finally still releases the lock
    logger.error({ err, threadId }, "Chat message processing failed");
    eventBus.emit("chat.error", {
      project_id: thread.project_id,
      thread_id: thread.id,
      error: err instanceof Error ? err.message : String(err),
    });
    eventBus.emit("chat.complete", {
      project_id: thread.project_id,
      thread_id: thread.id,
      message_id: assistantMsgId ?? "",
    });
  } finally {
    activeThreads.delete(threadId);
  }
}

async function runClaudeSession(
  thread: NonNullable<Awaited<ReturnType<typeof getThread>>>,
  content: string,
): Promise<ChatServiceResult> {
  const systemPrompt = await buildCaptainPrompt(thread.project_id);
  const model = resolveModel("captain");

  // Build environment: global env vars < project env vars < platform-specific vars
  const globalEnvVars = globalEnvVarRepo.getMap();
  const projectEnvVars = getEnvironmentVariablesMap(thread.project_id);

  // Set up SSH credentials — always clean up the temp key file
  const sshEnv: Record<string, string> = {};
  let sshKeyPath: string | null = null;
  try {
    sshKeyPath = await setupGitHubAuth(thread.project_id, sshEnv) ?? null;

    const baseEnv: Record<string, string> = {
      ...globalEnvVars,
      ...projectEnvVars,
      CREWDECK_API_URL: `http://localhost:${process.env.PORT || "9381"}`,
      CREWDECK_PROJECT_ID: thread.project_id,
      CREWDECK_AGENT_ID: "captain",
      ...(getSystemApiKey() ? { CREWDECK_API_KEY: getSystemApiKey()! } : {}),
      ...sshEnv,
    };

    // Try with --resume first if we have a session_id, fall back to fresh session
    const sessionId = thread.session_id;
    const needsResume = !!sessionId;

    const tmpFile = join(tmpdir(), `crewdeck-chat-${randomUUID()}.txt`);
    await writeFile(tmpFile, systemPrompt, "utf-8");

    const args = buildClaudeArgs(sessionId, model);

    const repos = listRepos(thread.project_id);
    const workdir = repos.length > 0 ? repos[0].local_path : tmpdir();

    // Create the assistant message row early so we can attach events to it
    const assistantMsg = createMessage(thread.id, "assistant", "");
    const assistantMsgId = assistantMsg.id;

    let capturedSessionId: string | null = sessionId;
    let assistantContent = "";
    let processFailed = false;

    let freshTmpFile: string | null = null;

    try {
      const result = await runClaudeProcess(args, content, workdir, {
        ...baseEnv,
        ...buildProviderEnv(model),
        ANTHROPIC_API_KEY: "",
        GIT_TERMINAL_PROMPT: "0",
      }, tmpFile, thread.project_id, thread.id, assistantMsgId);

      if (result.sessionExpired && needsResume) {
        // Session expired — clear it and retry fresh
        eventBus.emit("chat.session_expired", {
          project_id: thread.project_id,
          thread_id: thread.id,
        });
        updateThread(thread.id, { session_id: null });

        // Retry without resume
        const freshArgs = buildClaudeArgs(null, model);
        freshTmpFile = join(tmpdir(), `crewdeck-chat-${randomUUID()}.txt`);
        await writeFile(freshTmpFile, systemPrompt, "utf-8");

        const freshResult = await runClaudeProcess(freshArgs, content, workdir, {
          ...baseEnv,
          ...buildProviderEnv(model),
          ANTHROPIC_API_KEY: "",
          GIT_TERMINAL_PROMPT: "0",
        }, freshTmpFile, thread.project_id, thread.id, assistantMsgId);

        capturedSessionId = freshResult.sessionId;
        assistantContent = freshResult.content;
        processFailed = freshResult.failed;
      } else {
        capturedSessionId = result.sessionId;
        assistantContent = result.content;
        processFailed = result.failed;
      }
    } finally {
      try { await unlink(tmpFile); } catch {}
      if (freshTmpFile) try { await unlink(freshTmpFile); } catch {}
    }

    if (processFailed) {
      // Don't save a ghost message — emit error so frontend can show it
      eventBus.emit("chat.error", {
        project_id: thread.project_id,
        thread_id: thread.id,
        error: "Captain process failed. Try sending the message again.",
      });

      // Update session_id if we got one from the attempt
      if (capturedSessionId && capturedSessionId !== thread.session_id) {
        updateThread(thread.id, { session_id: capturedSessionId });
      }
      updateThread(thread.id, {});

      // Still fire chat.complete so frontend resets streaming state
      eventBus.emit("chat.complete", {
        project_id: thread.project_id,
        thread_id: thread.id,
        message_id: assistantMsgId,
      });

      // Delete the ghost assistant message so the thread isn't left with empty content
      deleteMessage(assistantMsgId);

      throw new Error("Captain process failed. Try sending the message again.");
    } else {
      // Update assistant message with final content
      updateMessage(assistantMsgId, assistantContent);

      // Update session_id if we got a new one
      if (capturedSessionId && capturedSessionId !== thread.session_id) {
        updateThread(thread.id, { session_id: capturedSessionId });
      }

      // Touch updated_at
      updateThread(thread.id, {});

      eventBus.emit("chat.complete", {
        project_id: thread.project_id,
        thread_id: thread.id,
        message_id: assistantMsgId,
      });

      // Fire-and-forget: auto-generate title if thread has none
      if (!thread.title) {
        generateThreadTitle(thread.id, thread.project_id, content, assistantContent);
      }

      return {
        message_id: assistantMsgId,
        session_id: capturedSessionId,
      };
    }
  } finally {
    if (sshKeyPath) cleanupSshKey(sshKeyPath);
  }
}

function buildClaudeArgs(sessionId: string | null, model: string): string[] {
  const args = [
    "-p",
    "--verbose",
    "--system-prompt-file", "PLACEHOLDER", // replaced per-call
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
    "--model", model,
  ];
  if (sessionId) {
    args.push("--resume", sessionId);
  }
  return args;
}

interface ClaudeRunResult {
  content: string;
  sessionId: string | null;
  sessionExpired: boolean;
  failed: boolean;
}

async function runClaudeProcess(
  args: string[],
  prompt: string,
  workdir: string,
  env: Record<string, string>,
  tmpFile: string,
  projectId: string,
  threadId: string,
  messageId: string,
): Promise<ClaudeRunResult> {
  // Replace the PLACEHOLDER with actual tmpFile path
  const finalArgs = args.map((a) => (a === "PLACEHOLDER" ? tmpFile : a));

  const child = spawn("claude", finalArgs, {
    cwd: workdir,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stdin!.end(prompt);

  let stderr = "";
  const stderrDone = new Promise<void>((resolve) => {
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stderr!.on("end", resolve);
  });

  let content = "";
  let sessionId: string | null = null;
  let sessionExpired = false;
  let lastToolCallId: string | null = null;
  // Map tool_use_id -> tool_name for matching with tool_results in new nested format
  const toolNamesById = new Map<string, string>();

  // Collect raw stdout to ensure we never lose data from fast-exiting processes.
  // Buffer partial lines across chunks so we only parse complete JSON lines.
  let rawStdout = "";
  let lineBuf = "";
  const stdoutDone = new Promise<void>((resolve) => {
    child.stdout!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      rawStdout += text;
      lineBuf += text;

      // Process all complete lines, keep the trailing partial for next chunk
      const parts = lineBuf.split("\n");
      lineBuf = parts.pop()!; // last element is either "" or a partial line
      for (const line of parts) {
        if (!line.trim()) continue;
        processStreamLine(line, projectId, threadId, messageId);
      }
    });
    child.stdout!.on("end", () => {
      // Flush any remaining partial line
      if (lineBuf.trim()) {
        processStreamLine(lineBuf, projectId, threadId, messageId);
      }
      resolve();
    });
  });

  // Create close promise before consuming stream to avoid race condition
  const closePromise = new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

  function processStreamLine(line: string, projId: string, thrdId: string, msgId: string): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }

    const type = event.type as string;

    if (type === "system") {
      const subtype = event.subtype as string | undefined;
      if (subtype === "init" && event.session_id) {
        sessionId = String(event.session_id);
      }
      if (event.message && String(event.message).includes("session")) {
        const msg = String(event.message).toLowerCase();
        if (msg.includes("expired") || msg.includes("not found") || msg.includes("invalid")) {
          sessionExpired = true;
        }
      }
      return;
    }

    if (type === "assistant" || type === "user") {
      // Normalize handles both old flat format and new nested message.content[] format
      const normalized = normalizeEvent({
        id: "",
        agent_run_id: "",
        type,
        data: event,
        created_at: new Date().toISOString(),
      });
      const d = normalized.data as Record<string, unknown>;

      if (type === "assistant") {
        if (typeof d.text === "string" && d.text) {
          content += d.text;
          chatEventRepo.createEvent(msgId, "text", { content: d.text });
          eventBus.emit("chat.message", {
            project_id: projId,
            thread_id: thrdId,
            message_id: msgId,
            content: d.text,
          });
        }
        if (typeof d.thinking === "string" && d.thinking) {
          chatEventRepo.createEvent(msgId, "thinking", { content: d.thinking });
          eventBus.emit("chat.thinking", {
            project_id: projId,
            thread_id: thrdId,
            message_id: msgId,
            content: d.thinking,
          });
        }
        if (Array.isArray(d.tool_use)) {
          for (const tu of d.tool_use) {
            const tuRec = tu as { id: string; name: string; input: unknown };
            const toolCallId = tuRec.id || `${tuRec.name}:${Date.now()}`;
            lastToolCallId = toolCallId;
            toolNamesById.set(toolCallId, tuRec.name);
            chatEventRepo.createEvent(msgId, "tool_call", {
              tool_call_id: toolCallId,
              tool_name: tuRec.name,
              tool_input: tuRec.input,
            });
            eventBus.emit("chat.tool_call", {
              project_id: projId,
              thread_id: thrdId,
              message_id: msgId,
              tool_call_id: toolCallId,
              tool_name: tuRec.name,
              tool_input: tuRec.input,
            });
          }
        }
      }

      if (type === "user" && Array.isArray(d.tool_results)) {
        for (const tr of d.tool_results) {
          const trRec = tr as { tool_use_id: string; output: string; is_error?: boolean };
          const toolCallId = trRec.tool_use_id || lastToolCallId || "";
          const toolName = toolNamesById.get(toolCallId) || "";
          chatEventRepo.createEvent(msgId, "tool_result", {
            tool_call_id: toolCallId,
            tool_name: toolName,
            result: trRec.output,
          });
          eventBus.emit("chat.tool_result", {
            project_id: projId,
            thread_id: thrdId,
            message_id: msgId,
            tool_call_id: toolCallId,
            tool_name: toolName,
            result: trRec.output,
          });
        }
      }
    }

    // Handle legacy flat tool_result events (old Claude CLI format)
    if (type === "tool_result" && event.tool_name) {
      const toolCallId = String(event.tool_call_id ?? lastToolCallId ?? "");
      chatEventRepo.createEvent(msgId, "tool_result", {
        tool_call_id: toolCallId,
        tool_name: String(event.tool_name),
        result: event.result,
      });
      eventBus.emit("chat.tool_result", {
        project_id: projId,
        thread_id: thrdId,
        message_id: msgId,
        tool_call_id: toolCallId,
        tool_name: String(event.tool_name),
        result: event.result,
      });
    }

    if (type === "result") {
      if (event.session_id && !sessionId) {
        sessionId = String(event.session_id);
      }
      if (event.is_error && Array.isArray(event.errors)) {
        const errMsg = (event.errors as string[]).join(" ").toLowerCase();
        if (errMsg.includes("session") || errMsg.includes("conversation") ||
            errMsg.includes("not found") || errMsg.includes("expired") || errMsg.includes("invalid")) {
          sessionExpired = true;
        }
      }
      chatEventRepo.createEvent(msgId, "result", event);
    }
  }

  // Wait for process to exit and all streams to fully drain
  const [exitCode] = await Promise.all([closePromise, stdoutDone, stderrDone]);

  if (stderr) {
    logger.warn({ stderr: stderr.slice(0, 1000) }, "Chat claude stderr");
  }

  if (exitCode !== 0 && !sessionExpired && !content) {
    logger.error({ exitCode, stderr: stderr.slice(0, 1000), stdout: rawStdout.slice(0, 1000), threadId }, "Claude chat process failed");
    return { content, sessionId, sessionExpired, failed: true };
  }

  return { content, sessionId, sessionExpired, failed: false };
}

const TITLE_SYSTEM_PROMPT =
  "Generate a concise 5-7 word title for this conversation. Output only the title, nothing else.";

/**
 * Fire-and-forget: generate a thread title from the first exchange.
 * On success, updates the DB and notifies the frontend. On failure, sets a fallback title.
 */
function generateThreadTitle(
  threadId: string,
  projectId: string,
  userMessage: string,
  assistantReply: string,
): void {
  const model = resolveModel("captain");
  const prompt = `User: ${userMessage.slice(0, 500)}\nAssistant: ${assistantReply.slice(0, 500)}`;

  spawnClaude({
    prompt,
    systemPrompt: TITLE_SYSTEM_PROMPT,
    workdir: process.cwd(),
    model,
  })
    .then(async ({ exitPromise }) => {
      const { code, stdout } = await exitPromise;

      if (code !== 0) {
        logger.warn({ threadId, code }, "Title generation exited non-zero");
        setFallbackTitle(threadId, projectId, userMessage);
        return;
      }

      let title = stdout.trim();
      // Claude CLI with --output-format json wraps the result
      try {
        const parsed = JSON.parse(title);
        if (Array.isArray(parsed)) {
          // New Claude CLI format: array of stream events
          const assistant = parsed.find((e: any) => e.type === 'assistant');
          const textBlock = assistant?.message?.content?.find((b: any) => b.type === 'text');
          title = textBlock?.text ?? title;
        } else {
          // Old format: single JSON object with result/text field
          title = parsed.result ?? parsed.text ?? title;
        }
      } catch {
        // If not valid JSON, use raw stdout
      }

      title = title.trim().replace(/^["']|["']$/g, "");
      if (!title || title.length < 2) {
        setFallbackTitle(threadId, projectId, userMessage);
        return;
      }

      // Re-read thread to avoid overwriting a user-set title (race condition)
      const current = getThread(threadId);
      if (current?.title) return;

      updateThread(threadId, { title });

      eventBus.emit("chat.thread_updated", {
        project_id: projectId,
        thread_id: threadId,
        title,
      });

      logger.info({ threadId, title }, "Thread title auto-generated");
    })
    .catch((err) => {
      logger.error({ threadId, err }, "Title generation failed");
      setFallbackTitle(threadId, projectId, userMessage);
    });
}

/**
 * Set a fallback title derived from the user's first message when auto-generation fails.
 */
function setFallbackTitle(threadId: string, projectId: string, userMessage: string): void {
  const current = getThread(threadId);
  if (current?.title) return;

  const fallback = userMessage.slice(0, 40).replace(/\n/g, " ").trim() || "New conversation";

  updateThread(threadId, { title: fallback });

  eventBus.emit("chat.thread_updated", {
    project_id: projectId,
    thread_id: threadId,
    title: fallback,
  });

  logger.info({ threadId, title: fallback }, "Thread fallback title set");
}
