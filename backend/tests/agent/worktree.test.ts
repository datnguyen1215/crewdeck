import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWorktree, cleanupWorktree } from "../../src/agent/worktree.js";
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
  assigned_agent_id: null,
  created_by: "user",
  max_review_rounds: null,
  current_review_round: 0,
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

  it("runs git worktree add with correct arguments", async () => {
    await createWorktree(repo, issue, "main");

    const cmd = vi.mocked(exec).mock.calls[0][0] as string;
    expect(cmd).toContain("git -C");
    expect(cmd).toContain("/repos/myrepo");
    expect(cmd).toContain("worktree add");
    expect(cmd).toContain("-b");
    expect(cmd).toContain("main");
  });

  it("uses correct branch naming convention: crewdeck/<issueId-short>-<slug>", async () => {
    await createWorktree(repo, issue, "main");

    const cmd = vi.mocked(exec).mock.calls[0][0] as string;
    // Branch should start with crewdeck/ and include the first 8 chars of the issue ID
    expect(cmd).toContain("crewdeck/abc12345");
    expect(cmd).toContain("fix-the-login-bug");
  });

  it("places worktree inside .worktrees directory", async () => {
    const { path } = await createWorktree(repo, issue, "main");

    expect(path).toContain("/repos/myrepo/.worktrees/");
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
      })
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
    await cleanupWorktree(repo, "/repos/myrepo/.worktrees/branch", "crewdeck/branch");

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
        (callback as (err: Error) => void)(new Error("branch has unmerged commits"));
      } else {
        (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "", stderr: "" }
        );
      }
      return {} as ReturnType<typeof exec>;
    });

    await expect(
      cleanupWorktree(repo, "/tmp/wt", "crewdeck/feat", true)
    ).resolves.toBeUndefined();
  });
});
