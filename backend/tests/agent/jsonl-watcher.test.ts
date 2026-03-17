import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JsonlWatcher } from "../../src/agent/jsonl-watcher.js";

// Mock fs/promises so no real files are touched
vi.mock("node:fs/promises", () => ({
  stat: vi.fn(),
  open: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: () => "/fakehome",
}));

import { stat, open } from "node:fs/promises";

function jsonlLine(entry: Record<string, unknown>): string {
  return JSON.stringify(entry) + "\n";
}

function assistantEntry(text: string, uuid?: string): Record<string, unknown> {
  return {
    type: "assistant",
    uuid: uuid ?? crypto.randomUUID(),
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  };
}

/** Simulate a file with the given content string. */
function mockFile(content: string) {
  const buf = Buffer.from(content, "utf-8");
  vi.mocked(stat).mockResolvedValue({ size: buf.length } as never);
  vi.mocked(open).mockResolvedValue({
    read: vi.fn().mockResolvedValue({ bytesRead: buf.length }),
    close: vi.fn().mockResolvedValue(undefined),
  } as never);
  // Patch the read mock to copy content into the provided buffer
  vi.mocked(open).mockResolvedValue({
    read: vi.fn().mockImplementation(async (target: Buffer, _offset: number, length: number, position: number) => {
      buf.copy(target, 0, position, position + length);
      return { bytesRead: length };
    }),
    close: vi.fn().mockResolvedValue(undefined),
  } as never);
}

describe("JsonlWatcher", () => {
  let watcher: JsonlWatcher;
  let onText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onText = vi.fn();
    watcher = new JsonlWatcher("test-session-id", "/tmp", onText);
  });

  afterEach(() => {
    watcher.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("constructs the correct JSONL file path", () => {
    // Access private field for verification
    expect((watcher as any).filePath).toBe("/fakehome/.claude/projects/-tmp/test-session-id.jsonl");
  });

  it("emits text from assistant entries", async () => {
    const content = jsonlLine(assistantEntry("Hello world"));
    mockFile(content);

    watcher.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(onText).toHaveBeenCalledTimes(1);
    expect(onText.mock.calls[0][0]).toBe("Hello world");
  });

  it("ignores non-assistant entries", async () => {
    const content =
      jsonlLine({ type: "user", message: { role: "user", content: "hi" } }) +
      jsonlLine({ type: "progress", data: {} }) +
      jsonlLine(assistantEntry("Only this"));
    mockFile(content);

    watcher.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(onText).toHaveBeenCalledTimes(1);
    expect(onText.mock.calls[0][0]).toBe("Only this");
  });

  it("deduplicates by UUID", async () => {
    const uuid = "dup-uuid-1234";
    const content =
      jsonlLine(assistantEntry("First", uuid)) +
      jsonlLine(assistantEntry("First", uuid));
    mockFile(content);

    watcher.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(onText).toHaveBeenCalledTimes(1);
  });

  it("joins multiple text blocks in one entry", async () => {
    const entry = {
      type: "assistant",
      uuid: crypto.randomUUID(),
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Part 1" },
          { type: "tool_use", name: "Read" },
          { type: "text", text: "Part 2" },
        ],
      },
    };
    mockFile(jsonlLine(entry));

    watcher.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(onText).toHaveBeenCalledTimes(1);
    expect(onText.mock.calls[0][0]).toBe("Part 1\nPart 2");
  });

  it("skips entries with no text content blocks", async () => {
    const entry = {
      type: "assistant",
      uuid: crypto.randomUUID(),
      message: {
        role: "assistant",
        content: [{ type: "tool_use", name: "Bash" }],
      },
    };
    mockFile(jsonlLine(entry));

    watcher.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(onText).not.toHaveBeenCalled();
  });

  it("does not advance offset past incomplete trailing line", async () => {
    // Simulate a file that ends with an incomplete line (no trailing newline)
    const completeLine = jsonlLine(assistantEntry("Complete"));
    const partial = '{"type":"assistant","message":{"content":[{"type":"text","text":"cut off';
    const fileContent = completeLine + partial;
    const buf = Buffer.from(fileContent, "utf-8");

    vi.mocked(stat).mockResolvedValue({ size: buf.length } as never);
    vi.mocked(open).mockResolvedValue({
      read: vi.fn().mockImplementation(async (target: Buffer, _offset: number, length: number, position: number) => {
        buf.copy(target, 0, position, position + length);
        return { bytesRead: length };
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    watcher.start();
    await vi.advanceTimersByTimeAsync(1000);

    // Should emit the complete line
    expect(onText).toHaveBeenCalledTimes(1);
    expect(onText.mock.calls[0][0]).toBe("Complete");

    // Offset should be at the end of the complete line, not the end of the file
    const expectedOffset = Buffer.byteLength(completeLine, "utf-8");
    expect((watcher as any).offset).toBe(expectedOffset);
  });

  it("picks up the rest of a partial line on next poll", async () => {
    const completeLine = jsonlLine(assistantEntry("Complete"));
    const partialJson = assistantEntry("Was partial");
    const partial = JSON.stringify(partialJson).slice(0, 20); // incomplete

    // First poll: complete line + partial
    const firstContent = completeLine + partial;
    const firstBuf = Buffer.from(firstContent, "utf-8");

    vi.mocked(stat).mockResolvedValue({ size: firstBuf.length } as never);
    vi.mocked(open).mockResolvedValue({
      read: vi.fn().mockImplementation(async (target: Buffer, _offset: number, length: number, position: number) => {
        firstBuf.copy(target, 0, position, position + length);
        return { bytesRead: length };
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    watcher.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onText).toHaveBeenCalledTimes(1);

    // Second poll: partial is now complete
    const fullContent = completeLine + jsonlLine(partialJson);
    const fullBuf = Buffer.from(fullContent, "utf-8");

    vi.mocked(stat).mockResolvedValue({ size: fullBuf.length } as never);
    vi.mocked(open).mockResolvedValue({
      read: vi.fn().mockImplementation(async (target: Buffer, _offset: number, length: number, position: number) => {
        fullBuf.copy(target, 0, position, position + length);
        return { bytesRead: length };
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    await vi.advanceTimersByTimeAsync(1000);
    expect(onText).toHaveBeenCalledTimes(2);
    expect(onText.mock.calls[1][0]).toBe("Was partial");
  });

  it("handles missing file gracefully", async () => {
    vi.mocked(stat).mockRejectedValue(new Error("ENOENT"));

    watcher.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(onText).not.toHaveBeenCalled();
  });

  it("handles empty file", async () => {
    vi.mocked(stat).mockResolvedValue({ size: 0 } as never);

    watcher.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(onText).not.toHaveBeenCalled();
  });

  it("stops polling after stop()", async () => {
    const content = jsonlLine(assistantEntry("Hello"));
    mockFile(content);

    watcher.start();
    watcher.stop();
    await vi.advanceTimersByTimeAsync(2000);

    expect(onText).not.toHaveBeenCalled();
  });

  it("skips malformed complete lines without breaking", async () => {
    const content =
      jsonlLine(assistantEntry("Before")) +
      "not valid json\n" +
      jsonlLine(assistantEntry("After"));
    mockFile(content);

    watcher.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(onText).toHaveBeenCalledTimes(2);
    expect(onText.mock.calls[0][0]).toBe("Before");
    expect(onText.mock.calls[1][0]).toBe("After");
  });
});
