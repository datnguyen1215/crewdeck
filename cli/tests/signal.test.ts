import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ENV = {
  CREWDECK_API_URL: "http://localhost:3000/api/v1",
  CREWDECK_SESSION_ID: "session-1",
  CREWDECK_ISSUE_ID: "issue-1",
  CREWDECK_AGENT_ID: "agent-1",
  CREWDECK_PROJECT_ID: "project-1",
};

describe("signalCommand", () => {
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

  it("sends work-complete signal with session context", async () => {
    const { signalCommand } = await import("../src/commands/signal.js");
    await signalCommand(["--event", "work-complete"]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/v1/internal/signal");
    const body = JSON.parse(opts.body as string);
    expect(body).toMatchObject({
      session_id: "session-1",
      agent_id: "agent-1",
      issue_id: "issue-1",
      project_id: "project-1",
      event: "work-complete",
    });
  });

  it("sends review-complete signal with data", async () => {
    const { signalCommand } = await import("../src/commands/signal.js");
    await signalCommand(["--event", "review-complete", "--data", '{"verdict":"approved"}']);

    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.event).toBe("review-complete");
    expect(body.data).toEqual({ verdict: "approved" });
  });

  it("sends error signal with message data", async () => {
    const { signalCommand } = await import("../src/commands/signal.js");
    await signalCommand(["--event", "error", "--data", '{"message":"something broke"}']);

    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.event).toBe("error");
    expect(body.data.message).toBe("something broke");
  });

  it("sends needs-help signal", async () => {
    const { signalCommand } = await import("../src/commands/signal.js");
    await signalCommand(["--event", "needs-help", "--data", '{"message":"unclear spec"}']);

    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.event).toBe("needs-help");
  });

  it("exits when --event is missing", async () => {
    const { signalCommand } = await import("../src/commands/signal.js");
    await expect(signalCommand([])).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when event name is invalid", async () => {
    const { signalCommand } = await import("../src/commands/signal.js");
    await expect(signalCommand(["--event", "bad-event"])).rejects.toThrow("process.exit called");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("unknown event"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when --data is invalid JSON", async () => {
    const { signalCommand } = await import("../src/commands/signal.js");
    await expect(signalCommand(["--event", "work-complete", "--data", "not-json"])).rejects.toThrow(
      "process.exit called"
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("valid JSON"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("propagates backend error", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "bad request" }),
    });

    const { signalCommand } = await import("../src/commands/signal.js");
    await expect(signalCommand(["--event", "work-complete"])).rejects.toThrow("bad request");
  });
});
