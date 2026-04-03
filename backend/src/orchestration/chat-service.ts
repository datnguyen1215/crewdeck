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
import { createInterface } from "node:readline";
import { logger } from "../logger.js";
import { eventBus } from "../events/bus.js";
import { buildProviderEnv } from "./provider-env.js";
import { buildSystemPrompt as buildCaptainPrompt } from "./captain-prompt.js";
import * as globalConfigRepo from "../db/repositories/global-config.js";
import {
  getThread,
  updateThread,
} from "../db/repositories/chat-threads.js";
import {
  createMessage,
} from "../db/repositories/chat-messages.js";
import { listRepos } from "../db/repositories/repos.js";
import { getSystemApiKey } from "../app.js";
import { ConflictError } from "../middleware/errors.js";

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
 * Send a message in a chat thread and get a streamed Claude response.
 */
export async function sendMessage(
  threadId: string,
  content: string,
): Promise<ChatServiceResult> {
  if (isThreadActive(threadId)) {
    throw new ConflictError("A message is already being processed for this thread");
  }

  const thread = getThread(threadId);
  if (!thread) throw new Error(`Thread ${threadId} not found`);

  activeThreads.set(threadId, true);

  try {
    return await runClaudeSession(thread, content);
  } finally {
    activeThreads.delete(threadId);
  }
}

async function runClaudeSession(
  thread: NonNullable<Awaited<ReturnType<typeof getThread>>>,
  content: string,
): Promise<ChatServiceResult> {
  const userMsg = createMessage(thread.id, "user", content);

  const systemPrompt = await buildCaptainPrompt(thread.project_id);
  const model = globalConfigRepo.getDefaultModel();

  // Build environment
  const baseEnv: Record<string, string> = {
    CREWDECK_API_URL: `http://localhost:${process.env.PORT || "9381"}`,
    CREWDECK_PROJECT_ID: thread.project_id,
    CREWDECK_AGENT_ID: "captain",
    ...(getSystemApiKey() ? { CREWDECK_API_KEY: getSystemApiKey()! } : {}),
  };

  // Try with --resume first if we have a session_id, fall back to fresh session
  const sessionId = thread.session_id;
  const needsResume = !!sessionId;

  const tmpFile = join(tmpdir(), `crewdeck-chat-${randomUUID()}.txt`);
  await writeFile(tmpFile, systemPrompt, "utf-8");

  const args = buildClaudeArgs(sessionId, model);

  const repos = listRepos(thread.project_id);
  const workdir = repos.length > 0 ? repos[0].local_path : tmpdir();

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
    }, tmpFile, thread.project_id, thread.id);

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
      }, freshTmpFile, thread.project_id, thread.id);

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

  if (processFailed || !assistantContent) {
    // Don't save a ghost message — emit error so frontend can show it
    eventBus.emit("chat.error", {
      project_id: thread.project_id,
      thread_id: thread.id,
      error: processFailed
        ? "Captain process failed. Try sending the message again."
        : "Captain did not produce a response.",
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
    });

    return {
      message_id: "",
      session_id: capturedSessionId,
    };
  } else {
    // Save assistant message
    const assistantMsg = createMessage(thread.id, "assistant", assistantContent);

    // Update session_id if we got a new one
    if (capturedSessionId && capturedSessionId !== thread.session_id) {
      updateThread(thread.id, { session_id: capturedSessionId });
    }

    // Touch updated_at
    updateThread(thread.id, {});

    eventBus.emit("chat.complete", {
      project_id: thread.project_id,
      thread_id: thread.id,
      message_id: assistantMsg.id,
    });

    return {
      message_id: assistantMsg.id,
      session_id: capturedSessionId,
    };
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
  child.stderr!.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  let content = "";
  let sessionId: string | null = null;
  let sessionExpired = false;

  const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });
  child.on("exit", () => rl.close());
  rl.on("error", (err) => {
    logger.error({ err }, "Chat readline error");
  });

  // Create close promise before consuming stream to avoid race condition
  const closePromise = new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      logger.error({ line: line.slice(0, 200) }, "Failed to parse chat stream event");
      continue;
    }

    const type = event.type as string;

    // Capture session ID from system events
    if (type === "system") {
      const subtype = event.subtype as string | undefined;
      if (subtype === "init" && event.session_id) {
        sessionId = String(event.session_id);
      }
      // Detect session expiry
      if (event.message && String(event.message).includes("session")) {
        const msg = String(event.message).toLowerCase();
        if (msg.includes("expired") || msg.includes("not found") || msg.includes("invalid")) {
          sessionExpired = true;
        }
      }
      continue;
    }

    // Handle assistant message content
    if (type === "assistant") {
      const subtype = event.subtype as string | undefined;
      if (subtype === "text" && typeof event.content === "string") {
        content += event.content;
        eventBus.emit("chat.message", {
          project_id: projectId,
          thread_id: threadId,
          content: event.content,
        });
      } else if (subtype === "thinking") {
        eventBus.emit("chat.thinking", {
          project_id: projectId,
          thread_id: threadId,
        });
      } else if (subtype === "tool_use" && event.tool_name) {
        eventBus.emit("chat.tool_call", {
          project_id: projectId,
          thread_id: threadId,
          tool_name: String(event.tool_name),
          tool_input: event.tool_input,
        });
      }
    }

    if (type === "tool_result" && event.tool_name) {
      eventBus.emit("chat.tool_result", {
        project_id: projectId,
        thread_id: threadId,
        tool_name: String(event.tool_name),
        result: event.result,
      });
    }

    // Claude CLI stream-json emits "result" as the final event with session info
    if (type === "result") {
      if (event.session_id && !sessionId) {
        sessionId = String(event.session_id);
      }
    }
  }

  // Wait for process to exit (promise created before stream consumption)
  const exitCode = await closePromise;

  if (stderr) {
    logger.warn({ stderr: stderr.slice(0, 500) }, "Chat claude stderr");
  }

  if (exitCode !== 0 && !sessionExpired && !content) {
    logger.error({ exitCode, threadId }, "Claude chat process failed");
    return { content, sessionId, sessionExpired, failed: true };
  }

  return { content, sessionId, sessionExpired, failed: false };
}
