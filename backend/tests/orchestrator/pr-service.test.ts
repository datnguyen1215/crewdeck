import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPR } from "../../src/orchestrator/pr-service.js";
import type { Issue, Repo } from "../../src/types/entities.js";

// Mock child_process.execFile
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";

function mockExecFile(stdout: string, stderr = "") {
  vi.mocked(execFile).mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, callback?: unknown) => {
      const cb = (typeof _opts === "function" ? _opts : callback) as (
        err: null,
        result: { stdout: string; stderr: string }
      ) => void;
      cb(null, { stdout, stderr });
      return {} as ReturnType<typeof execFile>;
    }
  );
}

function mockExecFileFail(error: Error) {
  vi.mocked(execFile).mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, callback?: unknown) => {
      const cb = (typeof _opts === "function" ? _opts : callback) as (
        err: Error
      ) => void;
      cb(error);
      return {} as ReturnType<typeof execFile>;
    }
  );
}

describe("createPR", () => {
  const mockIssue: Issue = {
    id: "issue-1",
    project_id: "proj-1",
    title: "Fix bug",
    description: "This fixes the bug",
    status: "ready",
    priority: 0,
    assigned_agent_id: null,
    created_by: "user",
    max_review_rounds: null,
    current_review_round: 0,
    branch_name: "fix/bug-123",
    worktree_path: "/tmp/worktree",
    base_branch: "main",
    repo_id: "repo-1",
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
  };

  const mockRepo: Repo = {
    id: "repo-1",
    project_id: "proj-1",
    github_url: "https://github.com/owner/repo",
    name: "repo",
    owner: "owner",
    local_path: "/repos/owner/repo",
    default_branch: "main",
    created_at: "2024-01-01",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls gh pr create with correct arguments", async () => {
    mockExecFile("https://github.com/owner/repo/pull/42\n");

    const result = await createPR(mockIssue, mockRepo);

    expect(result.url).toBe("https://github.com/owner/repo/pull/42");
    expect(result.number).toBe(42);

    const [cmd, args] = vi.mocked(execFile).mock.calls[0] as [string, string[]];
    expect(cmd).toBe("gh");
    expect(args).toContain("pr");
    expect(args).toContain("create");
    expect(args).toContain("--title");
    expect(args).toContain("Fix bug");
    expect(args).toContain("--body");
    expect(args).toContain("This fixes the bug");
    expect(args).toContain("--base");
    expect(args).toContain("main");
    expect(args).toContain("--head");
    expect(args).toContain("fix/bug-123");
    // Should NOT include --json flag
    expect(args).not.toContain("--json");
  });

  it("uses worktree_path as cwd when available", async () => {
    mockExecFile("https://github.com/owner/repo/pull/1\n");

    await createPR(mockIssue, mockRepo);

    const opts = vi.mocked(execFile).mock.calls[0][2] as { cwd: string };
    expect(opts.cwd).toBe("/tmp/worktree");
  });

  it("falls back to repo local_path when worktree_path is null", async () => {
    mockExecFile("https://github.com/owner/repo/pull/1\n");

    const issueWithoutWorktree = { ...mockIssue, worktree_path: null };
    await createPR(issueWithoutWorktree, mockRepo);

    const opts = vi.mocked(execFile).mock.calls[0][2] as { cwd: string };
    expect(opts.cwd).toBe("/repos/owner/repo");
  });

  it("uses base_branch from issue when available", async () => {
    mockExecFile("https://github.com/owner/repo/pull/1\n");

    const issueWithBaseBranch = { ...mockIssue, base_branch: "develop" };
    await createPR(issueWithBaseBranch, mockRepo);

    const args = vi.mocked(execFile).mock.calls[0][1] as string[];
    const baseIdx = args.indexOf("--base");
    expect(args[baseIdx + 1]).toBe("develop");
  });

  it("falls back to repo default_branch when base_branch is null", async () => {
    mockExecFile("https://github.com/owner/repo/pull/1\n");

    const issueWithoutBaseBranch = { ...mockIssue, base_branch: null };
    const repoWithDevelop = { ...mockRepo, default_branch: "develop" };
    await createPR(issueWithoutBaseBranch, repoWithDevelop);

    const args = vi.mocked(execFile).mock.calls[0][1] as string[];
    const baseIdx = args.indexOf("--base");
    expect(args[baseIdx + 1]).toBe("develop");
  });

  it("passes GH_TOKEN in env when token is provided", async () => {
    mockExecFile("https://github.com/owner/repo/pull/1\n");

    await createPR(mockIssue, mockRepo, { token: "gho_secret" });

    const opts = vi.mocked(execFile).mock.calls[0][2] as { env: Record<string, string> };
    expect(opts.env.GH_TOKEN).toBe("gho_secret");
  });

  it("throws when issue has no branch_name", async () => {
    const issueNoBranch = { ...mockIssue, branch_name: null };

    await expect(createPR(issueNoBranch, mockRepo)).rejects.toThrow(
      "Issue has no branch_name set"
    );
  });

  it("throws when gh pr create fails", async () => {
    mockExecFileFail(new Error("gh: command not found"));

    await expect(createPR(mockIssue, mockRepo)).rejects.toThrow(
      "gh: command not found"
    );
  });

  it("throws when gh output is not a valid URL", async () => {
    mockExecFile("Error: something went wrong\n");

    await expect(createPR(mockIssue, mockRepo)).rejects.toThrow(
      "Unexpected gh pr create output"
    );
  });

  it("parses PR number from various GitHub URL formats", async () => {
    // Standard format
    mockExecFile("https://github.com/owner/repo/pull/123\n");
    let result = await createPR(mockIssue, mockRepo);
    expect(result.number).toBe(123);

    // Large PR number
    mockExecFile("https://github.com/owner/repo/pull/99999\n");
    result = await createPR(mockIssue, mockRepo);
    expect(result.number).toBe(99999);
  });
});
