import { spawn, type ChildProcess } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { logger } from "../logger.js";
import { getProvider } from "../db/repositories/global-config.js";

/**
 * Build environment variables for Claude CLI based on configured provider.
 * When GLM provider is selected, inject ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN.
 */
function buildProviderEnv(): Record<string, string> {
  const provider = getProvider();
  if (provider === "glm" && process.env.ZAI_API_KEY) {
    return {
      ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
      ANTHROPIC_AUTH_TOKEN: process.env.ZAI_API_KEY,
    };
  }
  return {};
}

export interface SpawnOpts {
  prompt: string;
  systemPrompt: string;
  workdir: string;
  env?: Record<string, string>;
  model?: string;
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
    "-p",
    "--system-prompt-file",
    tmpFile,
    "--output-format",
    "json",
    "--dangerously-skip-permissions",
  ];
  if (opts.model) args.push("--model", opts.model);

  const child = spawn("claude", args, {
    cwd: opts.workdir,
    env: {
      ...process.env,
      ...opts.env,
      ...buildProviderEnv(),
      ANTHROPIC_API_KEY: "",
      GIT_TERMINAL_PROMPT: "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Write prompt to stdin to avoid E2BIG when prompt exceeds ARG_MAX
  // Use end(data) to handle backpressure properly for large prompts
  child.stdin!.end(opts.prompt);

  let stdout = "";
  let stderr = "";
  child.stdout!.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr!.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const exitPromise = new Promise<{ code: number; stdout: string }>(
    (resolve) => {
      child.on("close", async (code) => {
        // Clean up temp file
        try {
          await unlink(tmpFile);
        } catch {
          /* ignore */
        }
        if (stderr) {
          logger.warn(
            { pid: child.pid, stderr: stderr.slice(0, 500) },
            "claude process stderr",
          );
        }
        resolve({ code: code ?? 1, stdout });
      });

      child.on("error", async (err) => {
        // Handle spawn/pipe failures (e.g., ENOENT if claude binary not found)
        try {
          await unlink(tmpFile);
        } catch {
          /* ignore */
        }
        logger.error({ pid: child.pid, err }, "claude process error");
        resolve({ code: 1, stdout: `Spawn error: ${err.message}` });
      });
    },
  );

  logger.info(
    { pid: child.pid, workdir: opts.workdir },
    "Spawned claude process",
  );

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
export async function spawnClaudeStream(
  opts: SpawnOpts,
): Promise<StreamSpawnResult> {
  const tmpFile = join(tmpdir(), `crewdeck-${randomUUID()}.txt`);
  await writeFile(tmpFile, opts.systemPrompt, "utf-8");

  const args = [
    "-p",
    "--verbose",
    "--system-prompt-file",
    tmpFile,
    "--output-format",
    "stream-json",
    "--dangerously-skip-permissions",
  ];
  if (opts.model) args.push("--model", opts.model);

  const child = spawn("claude", args, {
    cwd: opts.workdir,
    env: {
      ...process.env,
      ...opts.env,
      ...buildProviderEnv(),
      ANTHROPIC_API_KEY: "",
      GIT_TERMINAL_PROMPT: "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Write prompt to stdin to avoid E2BIG when prompt exceeds ARG_MAX
  // Use end(data) to handle backpressure properly for large prompts
  child.stdin!.end(opts.prompt);

  let stderr = "";
  child.stderr!.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });

  // Close readline interface when the process exits to allow 'close' event to fire
  child.on("exit", () => {
    rl.close();
  });

  // Handle readline errors to prevent silent failures
  rl.on("error", (err) => {
    logger.error({ pid: child.pid, err }, "Readline interface error");
  });

  async function* eventGenerator(): AsyncIterable<ClaudeStreamEvent> {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line) as ClaudeStreamEvent;
      } catch (err) {
        // Emit a system event so the parse failure is visible in the run events
        logger.error(
          { pid: child.pid, line: line.slice(0, 200), err },
          "Failed to parse stream event - data may be lost",
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
      try {
        await unlink(tmpFile);
      } catch {
        /* ignore */
      }
      if (stderr) {
        logger.warn(
          { pid: child.pid, stderr: stderr.slice(0, 500) },
          "claude process stderr",
        );
      }
      resolve({ code: code ?? 1 });
    });
  });

  logger.info(
    { pid: child.pid, workdir: opts.workdir },
    "Spawned claude stream process",
  );

  return {
    pid: child.pid!,
    process: child,
    events: eventGenerator(),
    exitPromise,
  };
}
