import { describe, it, expect } from "vitest";
import { setupCommandTest } from "./helpers.js";

describe("commentCommand", () => {
  const mocks = setupCommandTest({ id: "c1", content: "hello" });

  it("posts comment with session context", async () => {
    const { commentCommand } = await import("../src/commands/comment.js");
    await commentCommand(["--message", "Fixed the bug!"]);

    expect(mocks.fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = mocks.fetchMock.mock.calls[0];
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
    expect(mocks.exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when --message value is missing", async () => {
    const { commentCommand } = await import("../src/commands/comment.js");
    await expect(commentCommand(["--message"])).rejects.toThrow("process.exit called");
    expect(mocks.errorSpy).toHaveBeenCalledWith(expect.stringContaining("--message is required"));
  });

  it("propagates backend error message", async () => {
    mocks.fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: "Issue not found" }),
    });

    const { commentCommand } = await import("../src/commands/comment.js");
    await expect(commentCommand(["--message", "hello"])).rejects.toThrow("Issue not found");
  });
});
