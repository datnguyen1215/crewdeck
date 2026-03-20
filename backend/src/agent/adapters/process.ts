import { spawn, type ChildProcess } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
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
