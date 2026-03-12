import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ENV = {
  CREWDECK_API_URL: "http://localhost:3000/api/v1",
  CREWDECK_SESSION_ID: "session-1",
  CREWDECK_ISSUE_ID: "issue-1",
  CREWDECK_AGENT_ID: "agent-1",
  CREWDECK_PROJECT_ID: "project-1",
};

describe("filesCommand", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.assign(process.env, ENV);

    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of Object.keys(ENV)) delete process.env[key];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends modified files list with session context", async () => {
    const { filesCommand } = await import("../src/commands/files.js");
    await filesCommand(["--modified", "src/foo.ts", "src/bar.ts", "tests/foo.test.ts"]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/v1/internal/files");
    const body = JSON.parse(opts.body as string);
    expect(body).toMatchObject({
      session_id: "session-1",
      agent_id: "agent-1",
      issue_id: "issue-1",
      project_id: "project-1",
      modified: ["src/foo.ts", "src/bar.ts", "tests/foo.test.ts"],
    });
  });

  it("sends a single modified file", async () => {
    const { filesCommand } = await import("../src/commands/files.js");
    await filesCommand(["--modified", "src/index.ts"]);

    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.modified).toEqual(["src/index.ts"]);
  });

  it("exits when --modified is missing", async () => {
    const { filesCommand } = await import("../src/commands/files.js");
    await expect(filesCommand([])).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("--modified is required"));
  });

  it("exits when no files are provided after --modified", async () => {
    const { filesCommand } = await import("../src/commands/files.js");
    await expect(filesCommand(["--modified"])).rejects.toThrow("process.exit called");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("at least one file"));
  });

  it("stops collecting files at the next flag", async () => {
    const { filesCommand } = await import("../src/commands/files.js");
    await filesCommand(["--modified", "src/a.ts", "src/b.ts"]);

    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.modified).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("propagates backend error", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: "Session not found" }),
    });

    const { filesCommand } = await import("../src/commands/files.js");
    await expect(filesCommand(["--modified", "src/foo.ts"])).rejects.toThrow("Session not found");
  });
});
