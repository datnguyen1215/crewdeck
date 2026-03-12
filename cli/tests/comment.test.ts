import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ENV = {
  CREWDECK_API_URL: "http://localhost:3000/api/v1",
  CREWDECK_SESSION_ID: "session-1",
  CREWDECK_ISSUE_ID: "issue-1",
  CREWDECK_AGENT_ID: "agent-1",
  CREWDECK_PROJECT_ID: "project-1",
};

describe("commentCommand", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.assign(process.env, ENV);

    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "c1", content: "hello" }),
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

  it("posts comment with session context", async () => {
    const { commentCommand } = await import("../src/commands/comment.js");
    await commentCommand(["--message", "Fixed the bug!"]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/v1/internal/comment");
    const body = JSON.parse(opts.body as string);
    expect(body).toMatchObject({
      session_id: "session-1",
      agent_id: "agent-1",
      issue_id: "issue-1",
      project_id: "project-1",
      content: "Fixed the bug!",
    });
  });

  it("exits when --message is missing", async () => {
    const { commentCommand } = await import("../src/commands/comment.js");
    await expect(commentCommand([])).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when --message value is missing", async () => {
    const { commentCommand } = await import("../src/commands/comment.js");
    await expect(commentCommand(["--message"])).rejects.toThrow("process.exit called");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("--message is required"));
  });

  it("propagates backend error message", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: "Issue not found" }),
    });

    const { commentCommand } = await import("../src/commands/comment.js");
    await expect(commentCommand(["--message", "hello"])).rejects.toThrow("Issue not found");
  });
});
