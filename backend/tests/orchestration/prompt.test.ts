import { describe, it, expect } from "vitest";
import { buildPrompt } from "../../src/orchestration/prompt.js";
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

  it("includes dispatch-based trigger instructions", () => {
    const prompt = buildPrompt(issue, [], repo, "/tmp/work");
    expect(prompt).toContain("/dispatch agent-name");
    expect(prompt).toContain("@mentions are cosmetic references only");
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
  });

  it("engineer gets no API access (stdout is the comment)", () => {
    const prompt = buildPrompt({
      issue,
      comments: [],
      repo,
      worktreePath: "/tmp/work",
      agentId: "engineer",
    });
    expect(prompt).toContain("stdout is automatically posted as a comment");
    expect(prompt).not.toContain("internal/comment");
    expect(prompt).not.toContain("internal/issues/create");
    expect(prompt).not.toContain("PATCH");
  });

  it("lead/docs get no API access", () => {
    for (const agentId of ["lead", "docs"]) {
      const prompt = buildPrompt({
        issue,
        comments: [],
        repo,
        worktreePath: "/tmp/work",
        agentId,
      });
      expect(prompt).toContain("stdout is automatically posted as a comment");
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

  it("includes project knowledge when provided", () => {
    const prompt = buildPrompt({
      issue,
      comments: [],
      repo,
      worktreePath: "/tmp/work",
      agentId: "engineer",
      projectKnowledge: [
        {
          id: "k1",
          project_id: "p1",
          title: "Structure",
          category: "architecture",
          content: "Monorepo with backend/ and frontend/",
          source: null,
          agent_ids: null,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "k2",
          project_id: "p1",
          title: "Gotchas",
          category: "setup",
          content: "Run npm install first",
          source: null,
          agent_ids: null,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    expect(prompt).toContain("## Project Knowledge");
    expect(prompt).toContain("### Structure (architecture)");
    expect(prompt).toContain("Monorepo with backend/ and frontend/");
    expect(prompt).toContain("### Gotchas (setup)");
    expect(prompt).toContain("Run npm install first");
  });

  it("omits project knowledge section when array is empty", () => {
    const prompt = buildPrompt({
      issue,
      comments: [],
      repo,
      worktreePath: "/tmp/work",
      agentId: "engineer",
      projectKnowledge: [],
    });
    expect(prompt).not.toContain("## Project Knowledge");
  });

  it("omits project knowledge section when undefined", () => {
    const prompt = buildPrompt({
      issue,
      comments: [],
      repo,
      worktreePath: "/tmp/work",
      agentId: "engineer",
    });
    expect(prompt).not.toContain("## Project Knowledge");
  });
});
