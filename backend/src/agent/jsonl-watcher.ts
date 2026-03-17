import { open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "../logger.js";

const POLL_INTERVAL = 1000;

export interface JsonlEntry {
  type: string;
  message?: {
    role?: string;
    content?: Array<{ type: string; text?: string }>;
  };
  uuid?: string;
  [key: string]: unknown;
}

export type OnAssistantText = (text: string, uuid: string) => void;

/**
 * Watches a Claude Code JSONL session file for new assistant text entries.
 * Uses byte-offset polling to avoid re-reading old data.
 */
export class JsonlWatcher {
  private interval: ReturnType<typeof setInterval> | null = null;
  private offset = 0;
  private seenUuids = new Set<string>();
  private readonly filePath: string;

  constructor(
    private readonly claudeSessionId: string,
    private readonly workdir: string,
    private readonly onText: OnAssistantText,
  ) {
    // Claude Code stores JSONL at ~/.claude/projects/<encoded-workdir>/<session-id>.jsonl
    const encoded = workdir.replace(/\//g, "-");
    this.filePath = join(homedir(), ".claude", "projects", encoded, `${claudeSessionId}.jsonl`);
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => void this.poll(), POLL_INTERVAL);
    logger.debug({ path: this.filePath }, "JSONL watcher started");
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    logger.debug({ path: this.filePath }, "JSONL watcher stopped");
  }

  private async poll(): Promise<void> {
    let fh;
    try {
      const info = await stat(this.filePath).catch(() => null);
      if (!info || info.size <= this.offset) return;

      fh = await open(this.filePath, "r");
      const buf = Buffer.alloc(info.size - this.offset);
      await fh.read(buf, 0, buf.length, this.offset);

      const chunk = buf.toString("utf-8");
      // Only advance offset past complete lines — incomplete trailing data
      // (from a mid-write) is left for the next poll to re-read.
      const lastNewline = chunk.lastIndexOf("\n");
      if (lastNewline === -1) return; // no complete line yet
      this.offset += Buffer.byteLength(chunk.slice(0, lastNewline + 1), "utf-8");

      for (const line of chunk.slice(0, lastNewline).split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as JsonlEntry;
          this.processEntry(entry);
        } catch {
          // Malformed line — skip it
        }
      }
    } catch (err) {
      logger.debug({ err, path: this.filePath }, "JSONL poll error");
    } finally {
      await fh?.close();
    }
  }

  private processEntry(entry: JsonlEntry): void {
    if (entry.type !== "assistant") return;
    const uuid = entry.uuid as string | undefined;
    if (uuid && this.seenUuids.has(uuid)) return;
    if (uuid) this.seenUuids.add(uuid);

    const content = entry.message?.content;
    if (!Array.isArray(content)) return;

    const texts: string[] = [];
    for (const block of content) {
      if (block.type === "text" && block.text) {
        texts.push(block.text);
      }
    }

    const text = texts.join("\n").trim();
    if (text) {
      this.onText(text, uuid ?? crypto.randomUUID());
    }
  }
}
