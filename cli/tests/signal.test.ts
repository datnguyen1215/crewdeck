import { describe, it, expect } from "vitest";
import { setupCommandTest } from "./helpers.js";

describe("signalCommand", () => {
  const mocks = setupCommandTest({ ok: true });

  it("sends work-complete signal with session context", async () => {
    const { signalCommand } = await import("../src/commands/signal.js");
    await signalCommand(["--event", "work-complete"]);

    expect(mocks.fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = mocks.fetchMock.mock.calls[0];
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

  it("sends review-complete signal without --data (no data field sent, server applies default)", async () => {
    const { signalCommand } = await import("../src/commands/signal.js");
    await signalCommand(["--event", "review-complete"]);

    const [, opts] = mocks.fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.event).toBe("review-complete");
    expect(body.data).toBeUndefined();
  });

  it("sends review-complete signal with data", async () => {
    const { signalCommand } = await import("../src/commands/signal.js");
    await signalCommand(["--event", "review-complete", "--data", '{"verdict":"approved"}']);

    const [, opts] = mocks.fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.event).toBe("review-complete");
    expect(body.data).toEqual({ verdict: "approved" });
  });

  it("sends error signal with message data", async () => {
    const { signalCommand } = await import("../src/commands/signal.js");
    await signalCommand(["--event", "error", "--data", '{"message":"something broke"}']);

    const [, opts] = mocks.fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.event).toBe("error");
    expect(body.data.message).toBe("something broke");
  });

  it("sends needs-help signal", async () => {
    const { signalCommand } = await import("../src/commands/signal.js");
    await signalCommand(["--event", "needs-help", "--data", '{"message":"unclear spec"}']);

    const [, opts] = mocks.fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body.event).toBe("needs-help");
  });

  it("exits when --event is missing", async () => {
    const { signalCommand } = await import("../src/commands/signal.js");
    await expect(signalCommand([])).rejects.toThrow("process.exit called");
    expect(mocks.exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when event name is invalid", async () => {
    const { signalCommand } = await import("../src/commands/signal.js");
    await expect(signalCommand(["--event", "bad-event"])).rejects.toThrow("process.exit called");
    expect(mocks.errorSpy).toHaveBeenCalledWith(expect.stringContaining("unknown event"));
    expect(mocks.exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when --data is invalid JSON", async () => {
    const { signalCommand } = await import("../src/commands/signal.js");
    await expect(signalCommand(["--event", "work-complete", "--data", "not-json"])).rejects.toThrow(
      "process.exit called"
    );
    expect(mocks.errorSpy).toHaveBeenCalledWith(expect.stringContaining("valid JSON"));
    expect(mocks.exitSpy).toHaveBeenCalledWith(1);
  });

  it("propagates backend error", async () => {
    mocks.fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "bad request" }),
    });

    const { signalCommand } = await import("../src/commands/signal.js");
    await expect(signalCommand(["--event", "work-complete"])).rejects.toThrow("bad request");
  });
});
