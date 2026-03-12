import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ENV = {
  CREWDECK_API_URL: "http://localhost:3000/api/v1",
  CREWDECK_SESSION_ID: "session-1",
  CREWDECK_ISSUE_ID: "issue-1",
  CREWDECK_AGENT_ID: "agent-1",
  CREWDECK_PROJECT_ID: "project-1",
};

describe("statusCommand", () => {
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

  it.each(["active", "done", "error"] as const)("sends %s state with session context", async (state) => {
    const { statusCommand } = await import("../src/commands/status.js");
    await statusCommand(["--state", state]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/v1/internal/status");
    const body = JSON.parse(opts.body as string);
    expect(body).toMatchObject({
      session_id: "session-1",
      agent_id: "agent-1",
      issue_id: "issue-1",
      project_id: "project-1",
      state,
    });
  });

  it("exits when --state is missing", async () => {
    const { statusCommand } = await import("../src/commands/status.js");
    await expect(statusCommand([])).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when state is invalid", async () => {
    const { statusCommand } = await import("../src/commands/status.js");
    await expect(statusCommand(["--state", "running"])).rejects.toThrow("process.exit called");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("unknown state"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
