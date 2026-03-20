import { describe, it, expect } from "vitest";
import { buildPrompt } from "../../src/agent/prompt.js";
import type { Issue, Repo, Comment } from "../../src/types/entities.js";

const issue: Issue = {
  id: "issue-1",
  project_id: "proj-1",
  title: "Add login feature",
  description: "Implement OAuth2 login flow",
  status: "in_progress",
  priority: 1,
  created_by: "user",
  chain_depth: 0,
  branch_name: null,
  worktree_path: null,
  base_branch: null,
  repo_id: "repo-1",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

const repo: Repo = {
  id: "repo-1",
  project_id: "proj-1",
  github_url: "https://github.com/org/myrepo",
  name: "myrepo",
  owner: "org",
  local_path: "/tmp/repos/myrepo",
  default_branch: "main",
  created_at: "2026-01-01",
};

describe("buildPrompt", () => {
  it("includes issue title and description", () => {
    const prompt = buildPrompt(issue, [], repo, "/tmp/work");
    expect(prompt).toContain("Add login feature");
    expect(prompt).toContain("Implement OAuth2 login flow");
  });

  it("includes repo name and worktree path", () => {
    const prompt = buildPrompt(issue, [], repo, "/tmp/worktrees/branch");
    expect(prompt).toContain("myrepo");
    expect(prompt).toContain("/tmp/worktrees/branch");
  });

  it("includes API reference with environment variables", () => {
    const prompt = buildPrompt(issue, [], repo, "/tmp/work");
    expect(prompt).toContain("CREWDECK_API_URL");
    expect(prompt).toContain("CREWDECK_ISSUE_ID");
  });

  it("includes mention-based trigger instructions", () => {
    const prompt = buildPrompt(issue, [], repo, "/tmp/work");
    expect(prompt).toContain("@agent-name");
  });

  it("includes comments when provided", () => {
    const comments: Comment[] = [
      {
        id: "c1",
        issue_id: "issue-1",
        author_type: "user",
        author_id: null,
        content: "Please fix the redirect",
        created_at: "2026-01-01",
      },
    ];
    const prompt = buildPrompt(issue, comments, repo, "/tmp/work");
    expect(prompt).toContain("Comment History");
    expect(prompt).toContain("Please fix the redirect");
  });

  it("omits comment section when no comments provided", () => {
    const prompt = buildPrompt(issue, [], repo, "/tmp/work");
    expect(prompt).not.toContain("Comment History");
  });
});

describe("buildPrompt options form", () => {
  const otherIssues: Issue[] = [
    {
      id: "issue-2",
      project_id: "proj-1",
      title: "Fix navbar",
      description: "Navbar broken on mobile",
      status: "open",
      priority: 2,
      created_by: "user",
      chain_depth: 0,
      branch_name: null,
      worktree_path: null,
      base_branch: null,
      repo_id: "repo-1",
      created_at: "2026-01-02",
      updated_at: "2026-01-02",
    },
    {
      id: "issue-3",
      project_id: "proj-1",
      title: "Add dark mode",
      description: "Support dark theme",
      status: "in_progress",
      priority: 3,
      created_by: "user",
      chain_depth: 0,
      branch_name: null,
      worktree_path: null,
      base_branch: null,
      repo_id: "repo-1",
      created_at: "2026-01-03",
      updated_at: "2026-01-03",
    },
  ];

  it("captain gets full API reference including internal endpoints", () => {
    const prompt = buildPrompt({
      issue,
      comments: [],
      repo,
      worktreePath: "/tmp/work",
      agentId: "captain",
    });
    expect(prompt).toContain("internal/comment");
    expect(prompt).toContain("internal/issues/create");
    expect(prompt).toContain("internal/issues/update");
    expect(prompt).toContain("PATCH");
    expect(prompt).toContain("/activity");
    expect(prompt).not.toContain("Do not attempt to call other API endpoints");
  });

  it("engineer gets comment-only API access", () => {
    const prompt = buildPrompt({
      issue,
      comments: [],
      repo,
      worktreePath: "/tmp/work",
      agentId: "engineer",
    });
    expect(prompt).toContain("internal/comment");
    expect(prompt).toContain("Do not attempt to call other API endpoints");
    expect(prompt).not.toContain("internal/issues/create");
    expect(prompt).not.toContain("PATCH");
  });

  it("security/architect/quality get comment-only API access", () => {
    for (const agentId of ["security", "architect", "quality"]) {
      const prompt = buildPrompt({
        issue,
        comments: [],
        repo,
        worktreePath: "/tmp/work",
        agentId,
      });
      expect(prompt).toContain("Do not attempt to call other API endpoints");
      expect(prompt).not.toContain("internal/issues/create");
    }
  });

  it("captain gets all open/in-progress issues section", () => {
    const prompt = buildPrompt({
      issue,
      comments: [],
      repo,
      worktreePath: "/tmp/work",
      agentId: "captain",
      projectIssues: [issue, ...otherIssues],
    });
    expect(prompt).toContain("All Open/In-Progress Issues");
    expect(prompt).toContain("Fix navbar");
    expect(prompt).toContain("Add dark mode");
  });

  it("captain's project issues list excludes the current issue", () => {
    const prompt = buildPrompt({
      issue,
      comments: [],
      repo,
      worktreePath: "/tmp/work",
      agentId: "captain",
      projectIssues: [issue, ...otherIssues],
    });
    // The current issue title appears in the Issue section but not in the project issues list
    const issuesSection = prompt.split("## All Open/In-Progress Issues")[1]?.split("##")[0] ?? "";
    expect(issuesSection).not.toContain("issue-1");
    expect(issuesSection).toContain("issue-2");
    expect(issuesSection).toContain("issue-3");
  });

  it("captain omits issues section when projectIssues is empty", () => {
    const prompt = buildPrompt({
      issue,
      comments: [],
      repo,
      worktreePath: "/tmp/work",
      agentId: "captain",
      projectIssues: [],
    });
    expect(prompt).not.toContain("All Open/In-Progress Issues");
  });

  it("captain omits issues section when only the current issue is in the list", () => {
    const prompt = buildPrompt({
      issue,
      comments: [],
      repo,
      worktreePath: "/tmp/work",
      agentId: "captain",
      projectIssues: [issue],
    });
    expect(prompt).not.toContain("All Open/In-Progress Issues");
  });

  it("non-captain agents do not get project issues even if passed", () => {
    const prompt = buildPrompt({
      issue,
      comments: [],
      repo,
      worktreePath: "/tmp/work",
      agentId: "engineer",
      projectIssues: otherIssues,
    });
    expect(prompt).not.toContain("All Open/In-Progress Issues");
  });
});
