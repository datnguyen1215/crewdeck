import { describe, it, expect } from "vitest";
import { setupCommandTest } from "./helpers.js";

describe("filesCommand", () => {
  const mocks = setupCommandTest({ ok: true });

  it("sends modified files list with session context", async () => {
    const { filesCommand } = await import("../src/commands/files.js");
    await filesCommand(["--modified", "src/foo.ts", "src/bar.ts", "tests/foo.test.ts"]);

    expect(mocks.fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = mocks.fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/v1/internal/files");
    const body = JSON.parse(opts.body as string);
    expect(body).toMatchObject({
      session_id: "session-1",
      modified: ["src/foo.ts", "src/bar.ts", "tests/foo.test.ts"],
    });
  });

  it("sends a single modified file", async () => {
    const { filesCommand } = await import("../src/commands/files.js");
    await filesCommand(["--modified", "src/index.ts"]);

    const [, opts] = mocks.fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.modified).toEqual(["src/index.ts"]);
  });

  it("exits when --modified is missing", async () => {
    const { filesCommand } = await import("../src/commands/files.js");
    await expect(filesCommand([])).rejects.toThrow("process.exit called");
    expect(mocks.exitSpy).toHaveBeenCalledWith(1);
    expect(mocks.errorSpy).toHaveBeenCalledWith(expect.stringContaining("--modified is required"));
  });

  it("exits when no files are provided after --modified", async () => {
    const { filesCommand } = await import("../src/commands/files.js");
    await expect(filesCommand(["--modified"])).rejects.toThrow("process.exit called");
    expect(mocks.errorSpy).toHaveBeenCalledWith(expect.stringContaining("at least one file"));
  });

  it("stops collecting files at the next flag", async () => {
    const { filesCommand } = await import("../src/commands/files.js");
    await filesCommand(["--modified", "src/a.ts", "src/b.ts"]);

    const [, opts] = mocks.fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.modified).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("propagates backend error", async () => {
    mocks.fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: "Session not found" }),
    });

    const { filesCommand } = await import("../src/commands/files.js");
    await expect(filesCommand(["--modified", "src/foo.ts"])).rejects.toThrow("Session not found");
  });
});
