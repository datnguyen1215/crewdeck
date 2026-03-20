import { spawn, type ChildProcess } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { logger } from "../../logger.js";

export interface SpawnOpts {
  prompt: string;
  systemPrompt: string;
  workdir: string;
  env?: Record<string, string>;
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
    "-p", opts.prompt,
    "--system-prompt-file", tmpFile,
    "--output-format", "json",
    "--dangerously-skip-permissions",
  ];

  const child = spawn("claude", args, {
    cwd: opts.workdir,
    env: { ...process.env, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

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
    "-p", opts.prompt,
    "--system-prompt-file", tmpFile,
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
  ];

  const child = spawn("claude", args, {
    cwd: opts.workdir,
    env: { ...process.env, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

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
