import { spawn, type ChildProcess } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { logger } from "../logger.js";

export interface SpawnOpts {
  prompt: string;
  systemPrompt: string;
  workdir: string;
  env?: Record<string, string>;
}

/** Image content for multimodal messages */
export interface ImageContent {
  data: string;
  mediaType: string;
}

export interface SpawnResult {
  pid: number;
  process: ChildProcess;
  exitPromise: Promise<{ code: number; stdout: string }>;
}

export async function spawnClaude(opts: SpawnOpts): Promise<SpawnResult> {
  const tmpFile = join(tmpdir(), `crewdeck-${randomUUID()}.txt`);
  await writeFile(tmpFile, opts.systemPrompt, "utf-8");

  const args = [
    "--system-prompt-file", tmpFile,
    "--output-format", "json",
    "--dangerously-skip-permissions",
  ];

  const child = spawn("claude", args, {
    cwd: opts.workdir,
    env: { ...process.env, ...opts.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Write prompt to stdin to avoid E2BIG when prompt exceeds ARG_MAX
  // Use end(data) to handle backpressure properly for large prompts
  child.stdin!.end(opts.prompt);

  let stdout = "";
  let stderr = "";
  child.stdout!.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

  const exitPromise = new Promise<{ code: number; stdout: string }>((resolve) => {
    child.on("close", async (code) => {
      // Clean up temp file
      try { await unlink(tmpFile); } catch { /* ignore */ }
      if (stderr) {
        logger.warn({ pid: child.pid, stderr: stderr.slice(0, 500) }, "claude process stderr");
      }
      resolve({ code: code ?? 1, stdout });
    });

    child.on("error", async (err) => {
      // Handle spawn/pipe failures (e.g., ENOENT if claude binary not found)
      try { await unlink(tmpFile); } catch { /* ignore */ }
      logger.error({ pid: child.pid, err }, "claude process error");
      resolve({ code: 1, stdout: `Spawn error: ${err.message}` });
    });
  });

  logger.info({ pid: child.pid, workdir: opts.workdir }, "Spawned claude process");

  return { pid: child.pid!, process: child, exitPromise };
}

/** Stream event from Claude CLI with --output-format stream-json */
export interface ClaudeStreamEvent {
  type: string;
  [key: string]: unknown;
}

export interface StreamSpawnResult {
  pid: number;
  process: ChildProcess;
  /** Async iterator yielding parsed JSONL events */
  events: AsyncIterable<ClaudeStreamEvent>;
  /** Resolves when process exits with code */
  exitPromise: Promise<{ code: number }>;
}

/**
 * Spawn Claude CLI with streaming output (--output-format stream-json).
 * Returns an async iterator over JSONL events.
 */
export async function spawnClaudeStream(opts: SpawnOpts): Promise<StreamSpawnResult> {
  const tmpFile = join(tmpdir(), `crewdeck-${randomUUID()}.txt`);
  await writeFile(tmpFile, opts.systemPrompt, "utf-8");

  const args = [
    "--system-prompt-file", tmpFile,
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
  ];

  const child = spawn("claude", args, {
    cwd: opts.workdir,
    env: { ...process.env, ...opts.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Write prompt to stdin to avoid E2BIG when prompt exceeds ARG_MAX
  // Use end(data) to handle backpressure properly for large prompts
  child.stdin!.end(opts.prompt);

  let stderr = "";
  child.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

  const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });

  async function* eventGenerator(): AsyncIterable<ClaudeStreamEvent> {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line) as ClaudeStreamEvent;
      } catch (err) {
        // Emit a system event so the parse failure is visible in the run events
        logger.error(
          { pid: child.pid, line: line.slice(0, 200), err },
          "Failed to parse stream event - data may be lost"
        );
        yield {
          type: "system",
          message: `Failed to parse stream event: ${line.slice(0, 100)}${line.length > 100 ? "..." : ""}`,
          error: true,
        } as ClaudeStreamEvent;
      }
    }
  }

  const exitPromise = new Promise<{ code: number }>((resolve) => {
    child.on("close", async (code) => {
      try { await unlink(tmpFile); } catch { /* ignore */ }
      if (stderr) {
        logger.warn({ pid: child.pid, stderr: stderr.slice(0, 500) }, "claude process stderr");
      }
      resolve({ code: code ?? 1 });
    });
  });

  logger.info({ pid: child.pid, workdir: opts.workdir }, "Spawned claude stream process");

  return { pid: child.pid!, process: child, events: eventGenerator(), exitPromise };
}

export interface MultimodalSpawnOpts {
  /** Text content of the message */
  text: string;
  /** Optional images to include */
  images?: ImageContent[];
  /** Conversation history as formatted text (past images replaced with [image attached]) */
  history?: string;
  systemPrompt: string;
  workdir: string;
  env?: Record<string, string>;
}

/**
 * Build a user message with content blocks for stream-json input.
 * Format follows Claude API: array of text and image content blocks.
 */
function buildUserContent(text: string, images?: ImageContent[]): unknown[] {
  const content: unknown[] = [];

  // Add images first (Claude works best with images before text)
  if (images && images.length > 0) {
    for (const img of images) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mediaType,
          data: img.data,
        },
      });
    }
  }

  // Add text content
  content.push({
    type: "text",
    text,
  });

  return content;
}

/**
 * Spawn Claude CLI with stream-json input/output for multimodal support.
 * Uses --input-format stream-json to send images via stdin.
 */
export async function spawnClaudeMultimodal(opts: MultimodalSpawnOpts): Promise<SpawnResult> {
  const tmpFile = join(tmpdir(), `crewdeck-${randomUUID()}.txt`);
  await writeFile(tmpFile, opts.systemPrompt, "utf-8");

  const args = [
    "--system-prompt-file", tmpFile,
    "--input-format", "stream-json",
    "--output-format", "json",
    "--dangerously-skip-permissions",
  ];

  const child = spawn("claude", args, {
    cwd: opts.workdir,
    env: { ...process.env, ...opts.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Build the full prompt text including history
  const fullText = opts.history
    ? `${opts.history}\n\n${opts.text}`
    : opts.text;

  // Build user message with content blocks
  const userContent = buildUserContent(fullText, opts.images);

  // Stream-json input format: send a user message object
  const inputMessage = {
    type: "user",
    content: userContent,
  };

  // Write the message as NDJSON to stdin and close (use end() with data for backpressure safety)
  child.stdin!.end(JSON.stringify(inputMessage) + "\n");

  let stdout = "";
  let stderr = "";
  child.stdout!.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

  const exitPromise = new Promise<{ code: number; stdout: string }>((resolve) => {
    child.on("close", async (code) => {
      try { await unlink(tmpFile); } catch { /* ignore */ }
      if (stderr) {
        logger.warn({ pid: child.pid, stderr: stderr.slice(0, 500) }, "claude multimodal process stderr");
      }
      resolve({ code: code ?? 1, stdout });
    });

    child.on("error", async (err) => {
      try { await unlink(tmpFile); } catch { /* ignore */ }
      logger.error({ pid: child.pid, err }, "claude multimodal process error");
      resolve({ code: 1, stdout: `Spawn error: ${err.message}` });
    });
  });

  logger.info(
    { pid: child.pid, workdir: opts.workdir, hasImages: !!opts.images?.length },
    "Spawned claude multimodal process"
  );

  return { pid: child.pid!, process: child, exitPromise };
}
