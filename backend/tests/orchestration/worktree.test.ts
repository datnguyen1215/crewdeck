import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import {
  slugify,
  createWorktree,
  cleanupWorktree,
} from "../../src/orchestration/worktree.js";
import { generateBranchName } from "../../src/orchestration/worktree.js";
import type { Repo, Issue } from "../../src/types/entities.js";

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
    },
  };
});

vi.mock("../../src/db/repositories/issues.js", () => ({
  updateIssue: vi.fn(),
}));

vi.mock("../../src/db/repositories/projects.js", () => ({
  getProject: vi.fn().mockReturnValue({ name: "my-project" }),
}));

import { exec } from "node:child_process";
import { updateIssue } from "../../src/db/repositories/issues.js";
import { mockExec as mockExecSuccess } from "../helpers/exec.js";

const repo: Repo = {
  id: "repo-1",
  project_id: "proj-1",
  repo_url: "https://github.com/org/repo",
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
  created_by: "user",
  chain_depth: 0,
  branch_name: null,
  worktree_path: null,
  base_branch: null,
  repo_id: "repo-1",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

describe("slugify", () => {
  it("lowercases and replaces non-alphanumeric with dashes", () => {
    expect(slugify("Fix the login bug")).toBe("fix-the-login-bug");
  });

  it("removes leading dashes", () => {
    expect(slugify("---hello")).toBe("hello");
  });

  it("truncates to 40 characters", () => {
    const long = Array(60).fill("word").join("-");
    expect(slugify(long).length).toBeLessThanOrEqual(40);
  });

  it("does not end with a dash after truncation", () => {
    const input = "something-long-that-truncates-with-dash-end";
    const result = slugify(input);
    expect(result.endsWith("-")).toBe(false);
  });

  it("handles trailing dash from original title after truncation", () => {
    const input = "something-long-that-truncates-with-dash-";
    const result = slugify(input);
    expect(result.endsWith("-")).toBe(false);
  });
});

describe("createWorktree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all calls succeed except rev-parse (branch doesn't exist yet)
    vi.mocked(exec).mockImplementation((...args: unknown[]) => {
      const cmdStr = args[0] as string;
      // callback may be 2nd or 3rd arg depending on whether options are passed
      const cb = typeof args[1] === "function" ? args[1] : args[2];
      if (cmdStr.includes("rev-parse --verify")) {
        (cb as (err: Error) => void)(new Error("branch not found"));
      } else {
        (cb as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "", stderr: "" },
        );
      }
      return {} as ReturnType<typeof exec>;
    });
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
    mockedExec.mockImplementation((...args: unknown[]) => {
      const cmdStr = args[0] as string;
      const cb = typeof args[1] === "function" ? args[1] : args[2];
      if (cmdStr.includes("fetch origin")) {
        (cb as (err: Error) => void)(new Error("network error"));
      } else if (cmdStr.includes("rev-parse --verify")) {
        (cb as (err: Error) => void)(new Error("branch not found"));
      } else {
        (cb as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "", stderr: "" },
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

  it("uses smart branch naming: crewdeck/<issueId-short>-<prefix>/<slug>-<hash>", async () => {
    await createWorktree(repo, issue, "main");

    const calls = vi.mocked(exec).mock.calls.map((c) => c[0] as string);
    const worktreeCmd = calls.find((c) => c.includes("worktree add"));
    // Branch should include issue ID, prefix, slugified title, and short hash
    expect(worktreeCmd).toContain("crewdeck/abc12345-fix/the-login-bug-abc1");
  });

  it("places worktree inside crewdeck directory under tmpdir organized by project", async () => {
    const { path } = await createWorktree(repo, issue, "main");

    expect(path).toContain(join("crewdeck", "my-project"));
    expect(path).toContain("crewdeck/abc12345-fix/the-login-bug-abc1");
  });

  it("updates the issue record with branch_name, worktree_path, and base_branch", async () => {
    const { path } = await createWorktree(repo, issue, "main");

    expect(updateIssue).toHaveBeenCalledWith(
      issue.id,
      expect.objectContaining({
        branch_name: expect.stringContaining("crewdeck/abc12345-fix/the-login-bug-abc1"),
        worktree_path: path,
        base_branch: "main",
      }),
    );
  });

  it("rebases existing branch onto origin/<baseBranch> after fetch", async () => {
    // Make rev-parse succeed so branchExists = true
    vi.mocked(exec).mockImplementation((...args: unknown[]) => {
      const cmdStr = args[0] as string;
      const cb = typeof args[1] === "function" ? args[1] : args[2];
      (cb as (err: null, result: { stdout: string; stderr: string }) => void)(
        null,
        { stdout: "", stderr: "" },
      );
      return {} as ReturnType<typeof exec>;
    });

    await createWorktree(repo, issue, "main");

    const calls = vi.mocked(exec).mock.calls.map((c) => c[0] as string);
    const rebaseCmd = calls.find((c) => c.includes("rebase"));
    expect(rebaseCmd).toBeDefined();
    expect(rebaseCmd).toContain("rebase");
    expect(rebaseCmd).toContain("origin/main");
  });

  it("skips rebase when fetch failed", async () => {
    vi.mocked(exec).mockImplementation((...args: unknown[]) => {
      const cmdStr = args[0] as string;
      const cb = typeof args[1] === "function" ? args[1] : args[2];
      if (cmdStr.includes("fetch origin")) {
        (cb as (err: Error) => void)(new Error("network error"));
      } else {
        (cb as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "", stderr: "" },
        );
      }
      return {} as ReturnType<typeof exec>;
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await createWorktree(repo, issue, "main");

    const calls = vi.mocked(exec).mock.calls.map((c) => c[0] as string);
    const rebaseCmd = calls.find((c) => c.includes("rebase"));
    expect(rebaseCmd).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("aborts rebase on conflict and warns", async () => {
    let rebaseAborted = false;
    vi.mocked(exec).mockImplementation((...args: unknown[]) => {
      const cmdStr = args[0] as string;
      const cb = typeof args[1] === "function" ? args[1] : args[2];
      if (cmdStr.includes("rebase --abort")) {
        rebaseAborted = true;
        (cb as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "", stderr: "" },
        );
      } else if (cmdStr.includes("rebase") && !cmdStr.includes("rev-parse")) {
        (cb as (err: Error) => void)(new Error("conflict"));
      } else {
        (cb as (err: null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "", stderr: "" },
        );
      }
      return {} as ReturnType<typeof exec>;
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await createWorktree(repo, issue, "main");

    expect(rebaseAborted).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to rebase"),
    );
    warnSpy.mockRestore();
  });

  it("returns the worktree path and branch name", async () => {
    const { path, branchName } = await createWorktree(repo, issue, "develop");
    expect(typeof path).toBe("string");
    expect(path.length).toBeGreaterThan(0);
    expect(branchName).toContain("crewdeck/abc12345-fix/the-login-bug-abc1");
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

describe("generateBranchName", () => {
  it('infers "fix" prefix for bug-related titles', () => {
    expect(generateBranchName("Fix login redirect loop", "aaaa")).toBe(
      "fix/login-redirect-loop-aaaa",
    );
    expect(generateBranchName("App crashes on startup", "bbbb")).toBe(
      "fix/app-crashes-on-startup-bbbb",
    );
    expect(generateBranchName("Broken pagination", "cccc")).toBe(
      "fix/pagination-cccc",
    );
  });

  it('infers "feature" prefix for additive titles', () => {
    expect(generateBranchName("Add dark mode support", "dddd")).toBe(
      "feature/add-dark-mode-support-dddd",
    );
    expect(generateBranchName("Create user settings page", "eeee")).toBe(
      "feature/create-user-settings-page-eeee",
    );
  });

  it('infers "refactor" prefix for refactoring titles', () => {
    expect(generateBranchName("Refactor auth module", "ffff")).toBe(
      "refactor/auth-module-ffff",
    );
    // "Cleanup" is a matched keyword at position 0, so it gets stripped from the slug
    expect(generateBranchName("Cleanup database queries", "gggg")).toBe(
      "refactor/database-queries-gggg",
    );
  });

  it('infers "update" prefix for modification titles', () => {
    expect(generateBranchName("Update user profile page", "hhhh")).toBe(
      "update/user-profile-page-hhhh",
    );
    expect(generateBranchName("Change default theme", "iiii")).toBe(
      "update/default-theme-iiii",
    );
  });

  it('infers "chore" prefix for removal titles', () => {
    expect(generateBranchName("Remove deprecated API", "jjjj")).toBe(
      "chore/deprecated-api-jjjj",
    );
    expect(generateBranchName("Delete old migration files", "kkkk")).toBe(
      "chore/old-migration-files-kkkk",
    );
  });

  it("strips the actual matched leading keyword from the slug", () => {
    expect(generateBranchName("Fix login bug", "aaaa")).toBe(
      "fix/login-bug-aaaa",
    );
    expect(generateBranchName("Fixes login redirect", "bbbb")).toBe(
      "fix/login-redirect-bbbb",
    );
    expect(generateBranchName("Fixed crash on startup", "cccc")).toBe(
      "fix/crash-on-startup-cccc",
    );
    expect(generateBranchName("Refactor auth module", "dddd")).toBe(
      "refactor/auth-module-dddd",
    );
    expect(generateBranchName("Remove deprecated API", "eeee")).toBe(
      "chore/deprecated-api-eeee",
    );
    expect(generateBranchName("Update user profile page", "ffff")).toBe(
      "update/user-profile-page-ffff",
    );
  });

  it("appends short hash from issueId for uniqueness", () => {
    const name1 = generateBranchName("Fix the bug", "abc11111-0000-0000-0000-000000000000");
    const name2 = generateBranchName("Fix the bug", "def22222-0000-0000-0000-000000000000");
    expect(name1).not.toBe(name2);
    expect(name1).toBe("fix/the-bug-abc1");
    expect(name2).toBe("fix/the-bug-def2");
  });

  it('defaults to "feature" when no keyword is matched', () => {
    expect(generateBranchName("Dashboard page redesign", "aaaa")).toBe(
      "feature/dashboard-page-redesign-aaaa",
    );
  });

  it("keeps non-leading keywords in the slug", () => {
    expect(generateBranchName("The login bug fix", "aaaa")).toBe(
      "fix/the-login-bug-fix-aaaa",
    );
    expect(generateBranchName("Database cleanup needed", "bbbb")).toBe(
      "refactor/database-cleanup-needed-bbbb",
    );
  });
});
