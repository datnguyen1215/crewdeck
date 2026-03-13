import { describe, it, expect } from "vitest";
import { setupCommandTest } from "./helpers.js";

describe("statusCommand", () => {
  const mocks = setupCommandTest({ ok: true });

  it.each(["active", "done", "error"] as const)("sends %s state with session context", async (state) => {
    const { statusCommand } = await import("../src/commands/status.js");
    await statusCommand(["--state", state]);

    expect(mocks.fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = mocks.fetchMock.mock.calls[0];
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
    expect(mocks.exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when state is invalid", async () => {
    const { statusCommand } = await import("../src/commands/status.js");
    await expect(statusCommand(["--state", "running"])).rejects.toThrow("process.exit called");
    expect(mocks.errorSpy).toHaveBeenCalledWith(expect.stringContaining("unknown state"));
    expect(mocks.exitSpy).toHaveBeenCalledWith(1);
  });
});
