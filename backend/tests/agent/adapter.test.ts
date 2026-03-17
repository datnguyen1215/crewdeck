import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClaudeCodeAdapter } from "../../src/agent/adapters/claude-code.js";

// Mock child_process.exec
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

// Mock fs/promises for script file writing
vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { exec } from "node:child_process";
import { mockExec, mockExecFail } from "../helpers/exec.js";

describe("ClaudeCodeAdapter", () => {
  let adapter: ClaudeCodeAdapter;

  beforeEach(() => {
    adapter = new ClaudeCodeAdapter();
    vi.clearAllMocks();
  });

  describe("spawn", () => {
    it("creates a tmux session with the correct name and workdir", async () => {
      const calls: string[] = [];
      const mockedExec = vi.mocked(exec);
      mockedExec.mockImplementation((cmd: unknown, callback: unknown) => {
        calls.push(cmd as string);
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "", stderr: "" }
        );
        return {} as ReturnType<typeof exec>;
      });

      const handle = await adapter.spawn({
        sessionName: "crewdeck-test",
        workdir: "/tmp/work",
        prompt: "do the thing",
      });

      expect(calls[0]).toContain("tmux new-session");
      expect(calls[0]).toContain("crewdeck-test");
      expect(calls[0]).toContain("/tmp/work");
      expect(handle.sessionName).toBe("crewdeck-test");
    });

    it("injects environment variables into the launch script", async () => {
      const mockedExec = vi.mocked(exec);
      mockedExec.mockImplementation((cmd: unknown, callback: unknown) => {
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "", stderr: "" }
        );
        return {} as ReturnType<typeof exec>;
      });

      const { writeFile } = await import("node:fs/promises");
      const writeMock = vi.mocked(writeFile);

      await adapter.spawn({
        sessionName: "test-env",
        workdir: "/tmp",
        prompt: "hello",
        env: { CREWDECK_SESSION_ID: "sess-1", CREWDECK_AGENT_ID: "agent-1" },
      });

      expect(writeMock).toHaveBeenCalledOnce();
      const scriptContent = writeMock.mock.calls[0][1] as string;
      expect(scriptContent).toContain("CREWDECK_SESSION_ID");
      expect(scriptContent).toContain("CREWDECK_AGENT_ID");
    });

    it("includes system-prompt in the launch script when provided", async () => {
      const mockedExec = vi.mocked(exec);
      mockedExec.mockImplementation((cmd: unknown, callback: unknown) => {
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "", stderr: "" }
        );
        return {} as ReturnType<typeof exec>;
      });

      const { writeFile } = await import("node:fs/promises");
      const writeMock = vi.mocked(writeFile);

      await adapter.spawn({
        sessionName: "test-sys",
        workdir: "/tmp",
        prompt: "task",
        systemPrompt: "you are an assistant",
      });

      expect(writeMock).toHaveBeenCalledOnce();
      const scriptContent = writeMock.mock.calls[0][1] as string;
      expect(scriptContent).toContain("--system-prompt");
      expect(scriptContent).toContain("--dangerously-skip-permissions");
    });
  });

  describe("send", () => {
    it("sends keys to the correct tmux session", async () => {
      const calls: string[] = [];
      const mockedExec = vi.mocked(exec);
      mockedExec.mockImplementation((cmd: unknown, callback: unknown) => {
        calls.push(cmd as string);
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "", stderr: "" }
        );
        return {} as ReturnType<typeof exec>;
      });

      await adapter.send("my-session", "hello world");

      // send() issues two exec calls: one with the text, one with Enter
      expect(calls.length).toBe(2);
      expect(calls[0]).toContain("tmux send-keys");
      expect(calls[0]).toContain("my-session");
      expect(calls[0]).toContain("hello world");
      expect(calls[1]).toContain("Enter");
    });
  });

  describe("getOutput", () => {
    it("runs tmux capture-pane and returns output", async () => {
      const mockedExec = vi.mocked(exec);
      mockedExec.mockImplementation((cmd: unknown, callback: unknown) => {
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "some output\n", stderr: "" }
        );
        return {} as ReturnType<typeof exec>;
      });

      const output = await adapter.getOutput("my-session");

      const cmd = vi.mocked(exec).mock.calls[0][0] as string;
      expect(cmd).toContain("tmux capture-pane");
      expect(cmd).toContain("my-session");
      expect(output).toBe("some output\n");
    });
  });

  describe("isAlive", () => {
    it("returns true when tmux has-session succeeds", async () => {
      mockExec();
      const alive = await adapter.isAlive("running-session");
      expect(alive).toBe(true);
    });

    it("returns false when tmux has-session fails", async () => {
      mockExecFail(new Error("no session"));
      const alive = await adapter.isAlive("dead-session");
      expect(alive).toBe(false);
    });
  });

  describe("kill", () => {
    it("sends exit and then force-kills if session persists", async () => {
      const calls: string[] = [];
      const mockedExec = vi.mocked(exec);
      let callCount = 0;

      mockedExec.mockImplementation((cmd: unknown, callback: unknown) => {
        calls.push(cmd as string);
        callCount++;
        // Simulate: send-keys succeeds, has-session keeps returning success
        // (until kill-session is called)
        (callback as (err: null | Error, result?: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "", stderr: "" }
        );
        return {} as ReturnType<typeof exec>;
      });

      // Override isAlive to return false after the kill-session call
      vi.spyOn(adapter, "isAlive").mockResolvedValue(false);

      await adapter.kill("stuck-session");

      const sendKeysCalls = calls.filter((c) => c.includes("send-keys"));
      expect(sendKeysCalls.length).toBeGreaterThan(0);
      expect(sendKeysCalls[0]).toContain("exit");
    });

    it("returns early if session is already dead when sending exit", async () => {
      mockExecFail(new Error("no session"));
      // Should not throw
      await expect(adapter.kill("dead-session")).resolves.toBeUndefined();
    });
  });

});
