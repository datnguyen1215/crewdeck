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
