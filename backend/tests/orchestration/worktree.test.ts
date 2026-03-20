import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWorktree, cleanupWorktree } from "../../src/orchestration/worktree.js";
import type { Repo, Issue } from "../../src/types/entities.js";

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

vi.mock("../../src/db/repositories/issues.js", () => ({
  updateIssue: vi.fn(),
}));

import { exec } from "node:child_process";
import { updateIssue } from "../../src/db/repositories/issues.js";
import { mockExec as mockExecSuccess, mockExecFail } from "../helpers/exec.js";

const repo: Repo = {
  id: "repo-1",
  project_id: "proj-1",
  github_url: "https://github.com/org/repo",
  name: "repo",
  owner: "org",
  local_path: "/repos/myrepo",
  default_branch: "main",
  created_at: "2026-01-01",
};

const issue: Issue = {
  id: "abc12345-0000-0000-0000-000000000000",
  project_id: "proj-1",
  title: "Fix the login bug",
  description: "Details here",
  status: "open",
  priority: 0,
  created_by: "user",
  chain_depth: 0,
  branch_name: null,
  worktree_path: null,
  base_branch: null,
  repo_id: "repo-1",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

describe("createWorktree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSuccess();
  });

  it("fetches from origin before creating worktree", async () => {
    await createWorktree(repo, issue, "main");

    const calls = vi.mocked(exec).mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toContain("git -C");
    expect(calls[0]).toContain("fetch origin");
  });

  it("uses origin/<baseBranch> as start point after successful fetch", async () => {
    await createWorktree(repo, issue, "main");

    const calls = vi.mocked(exec).mock.calls.map((c) => c[0] as string);
    const worktreeCmd = calls.find((c) => c.includes("worktree add"));
    expect(worktreeCmd).toContain("origin/main");
  });

  it("falls back to local branch when fetch fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockedExec = vi.mocked(exec);
    let callCount = 0;
    mockedExec.mockImplementation((cmd: unknown, callback: unknown) => {
      callCount++;
      // First call (fetch) fails; second call (worktree add) succeeds
      if (callCount === 1) {
        (callback as (err: Error) => void)(new Error("network error"));
      } else {
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "", stderr: "" }
        );
      }
      return {} as ReturnType<typeof exec>;
    });

    await createWorktree(repo, issue, "main");

    const calls = mockedExec.mock.calls.map((c) => c[0] as string);
    const worktreeCmd = calls.find((c) => c.includes("worktree add"));
    // Should use local branch, not origin/main
    expect(worktreeCmd).not.toContain("origin/main");
    expect(worktreeCmd).toMatch(/'main'$/);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("runs git worktree add with correct arguments", async () => {
    await createWorktree(repo, issue, "main");

    const calls = vi.mocked(exec).mock.calls.map((c) => c[0] as string);
    const worktreeCmd = calls.find((c) => c.includes("worktree add"));
    expect(worktreeCmd).toContain("git -C");
    expect(worktreeCmd).toContain("/repos/myrepo");
    expect(worktreeCmd).toContain("worktree add");
    expect(worktreeCmd).toContain("-b");
  });

  it("uses correct branch naming convention: crewdeck/<issueId-short>-<slug>", async () => {
    await createWorktree(repo, issue, "main");

    const calls = vi.mocked(exec).mock.calls.map((c) => c[0] as string);
    const worktreeCmd = calls.find((c) => c.includes("worktree add"));
    // Branch should start with crewdeck/ and include the first 8 chars of the issue ID
    expect(worktreeCmd).toContain("crewdeck/abc12345");
    expect(worktreeCmd).toContain("fix-the-login-bug");
  });

  it("places worktree inside crewdeck-worktrees directory under tmpdir", async () => {
    const { path } = await createWorktree(repo, issue, "main");

    expect(path).toContain("crewdeck-worktrees");
    expect(path).toContain("crewdeck/abc12345");
  });

  it("updates the issue record with branch_name, worktree_path, and base_branch", async () => {
    const { path } = await createWorktree(repo, issue, "main");

    expect(updateIssue).toHaveBeenCalledWith(
      issue.id,
      expect.objectContaining({
        branch_name: expect.stringContaining("crewdeck/abc12345"),
        worktree_path: path,
        base_branch: "main",
      }),
    );
  });

  it("returns the worktree path and branch name", async () => {
    const { path, branchName } = await createWorktree(repo, issue, "develop");
    expect(typeof path).toBe("string");
    expect(path.length).toBeGreaterThan(0);
    expect(branchName).toContain("crewdeck/abc12345");
  });
});

describe("cleanupWorktree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSuccess();
  });

  it("runs git worktree remove", async () => {
    await cleanupWorktree(
      repo,
      "/repos/myrepo/.worktrees/branch",
      "crewdeck/branch",
    );

    const cmd = vi.mocked(exec).mock.calls[0][0] as string;
    expect(cmd).toContain("worktree remove");
    expect(cmd).toContain("/repos/myrepo/.worktrees/branch");
  });

  it("does not delete branch by default", async () => {
    await cleanupWorktree(repo, "/tmp/wt", "crewdeck/feat");

    const calls = vi.mocked(exec).mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("branch -d"))).toBe(false);
  });

  it("deletes branch when deleteBranch=true", async () => {
    await cleanupWorktree(repo, "/tmp/wt", "crewdeck/feat", true);

    const calls = vi.mocked(exec).mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("branch -d"))).toBe(true);
  });

  it("does not throw when branch deletion fails (unmerged changes)", async () => {
    const mockedExec = vi.mocked(exec);
    let callCount = 0;
    mockedExec.mockImplementation((cmd: unknown, callback: unknown) => {
      callCount++;
      // First call (worktree remove) succeeds; second call (branch -d) fails
      if (callCount === 2) {
        (callback as (err: Error) => void)(
          new Error("branch has unmerged commits"),
        );
      } else {
        (
          callback as (
            err: null,
            result: { stdout: string; stderr: string },
          ) => void
        )(null, { stdout: "", stderr: "" });
      }
      return {} as ReturnType<typeof exec>;
    });

    await expect(
      cleanupWorktree(repo, "/tmp/wt", "crewdeck/feat", true),
    ).resolves.toBeUndefined();
  });
});
