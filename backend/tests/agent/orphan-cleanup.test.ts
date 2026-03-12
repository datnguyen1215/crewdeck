import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

vi.mock("../../src/db/repositories/sessions.js", () => ({
  listRunningSessions: vi.fn(),
  updateSession: vi.fn(),
}));

vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import { exec } from "node:child_process";
import { listRunningSessions, updateSession } from "../../src/db/repositories/sessions.js";
import { cleanupOrphans, gracefulShutdown } from "../../src/agent/orphan-cleanup.js";
import type { AgentAdapter } from "../../src/agent/types.js";
import type { Session } from "../../src/types/entities.js";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    project_id: "proj-1",
    session_type: "agent",
    agent_id: "agent-1",
    issue_id: "issue-1",
    tmux_session_name: "crewdeck-abc12345-def67890-developer",
    tmux_pane_id: "%0",
    status: "running",
    context: {},
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  };
}

function mockExec(stdout = "") {
  vi.mocked(exec).mockImplementation((_cmd: unknown, callback: unknown) => {
    (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
      null,
      { stdout, stderr: "" }
    );
    return {} as ReturnType<typeof exec>;
  });
}

function mockExecFail(error: Error) {
  vi.mocked(exec).mockImplementation((_cmd: unknown, callback: unknown) => {
    (callback as (err: Error) => void)(error);
    return {} as ReturnType<typeof exec>;
  });
}

describe("cleanupOrphans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when no crewdeck tmux sessions exist", async () => {
    mockExec(""); // empty session list
    await cleanupOrphans();
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("kills orphaned tmux sessions on startup", async () => {
    const calls: string[] = [];
    vi.mocked(exec).mockImplementation((cmd: unknown, callback: unknown) => {
      calls.push(cmd as string);
      const stdout =
        (cmd as string).includes("list-sessions")
          ? "crewdeck-abc12345-agent1-developer\nother-session\n"
          : "";
      (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
        null,
        { stdout, stderr: "" }
      );
      return {} as ReturnType<typeof exec>;
    });

    vi.mocked(listRunningSessions).mockReturnValue([]);
    await cleanupOrphans();

    const killCalls = calls.filter((c) => c.includes("kill-session"));
    expect(killCalls.length).toBe(1);
    expect(killCalls[0]).toContain("crewdeck-abc12345-agent1-developer");
    // Should NOT kill the non-crewdeck session
    expect(killCalls[0]).not.toContain("other-session");
  });

  it("updates DB session status to error for matching running sessions", async () => {
    vi.mocked(exec).mockImplementation((cmd: unknown, callback: unknown) => {
      const stdout =
        (cmd as string).includes("list-sessions")
          ? "crewdeck-abc12345-def67890-developer\n"
          : "";
      (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
        null,
        { stdout, stderr: "" }
      );
      return {} as ReturnType<typeof exec>;
    });

    const session = makeSession({ tmux_session_name: "crewdeck-abc12345-def67890-developer" });
    vi.mocked(listRunningSessions).mockReturnValue([session]);

    await cleanupOrphans();

    expect(updateSession).toHaveBeenCalledWith(session.id, { status: "error" });
  });

  it("handles tmux not being available gracefully", async () => {
    mockExecFail(new Error("tmux: command not found"));
    await expect(cleanupOrphans()).resolves.toBeUndefined();
    expect(updateSession).not.toHaveBeenCalled();
  });
});

describe("gracefulShutdown", () => {
  let adapter: AgentAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = {
      spawn: vi.fn(),
      send: vi.fn(),
      getOutput: vi.fn().mockResolvedValue("captured output"),
      streamOutput: vi.fn(),
      isAlive: vi.fn().mockResolvedValue(false),
      kill: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("does nothing when no running sessions exist", async () => {
    vi.mocked(listRunningSessions).mockReturnValue([]);
    await gracefulShutdown(adapter);
    expect(adapter.kill).not.toHaveBeenCalled();
  });

  it("captures output and kills each running session", async () => {
    const session = makeSession();
    vi.mocked(listRunningSessions).mockReturnValue([session]);

    await gracefulShutdown(adapter);

    expect(adapter.getOutput).toHaveBeenCalledWith(session.tmux_session_name);
    expect(adapter.kill).toHaveBeenCalledWith(session.tmux_session_name);
  });

  it("updates session status to completed after killing", async () => {
    const session = makeSession();
    vi.mocked(listRunningSessions).mockReturnValue([session]);

    await gracefulShutdown(adapter);

    const calls = vi.mocked(updateSession).mock.calls;
    const statusUpdate = calls.find(
      ([id, input]) => id === session.id && (input as { status?: string }).status === "completed"
    );
    expect(statusUpdate).toBeDefined();
  });

  it("saves output snapshot to session context", async () => {
    const session = makeSession();
    vi.mocked(listRunningSessions).mockReturnValue([session]);

    await gracefulShutdown(adapter);

    const contextCall = vi.mocked(updateSession).mock.calls.find(
      ([id, input]) =>
        id === session.id &&
        (input as { context?: unknown }).context !== undefined &&
        typeof (input as { context?: unknown }).context === "object"
    );
    expect(contextCall).toBeDefined();
    const ctx = (contextCall![1] as { context: Record<string, unknown> }).context;
    expect(ctx.shutdown_output).toBe("captured output");
  });

  it("skips sessions without a tmux_session_name", async () => {
    const session = makeSession({ tmux_session_name: null });
    vi.mocked(listRunningSessions).mockReturnValue([session]);

    await gracefulShutdown(adapter);

    expect(adapter.kill).not.toHaveBeenCalled();
  });
});
