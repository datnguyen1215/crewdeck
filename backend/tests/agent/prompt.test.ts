import { describe, it, expect } from "vitest";
import { buildAgentPrompt } from "../../src/agent/prompt.js";
import type { Issue, Agent, Repo, Comment } from "../../src/types/entities.js";

const issue: Issue = {
  id: "issue-1",
  project_id: "proj-1",
  title: "Add login feature",
  description: "Implement OAuth2 login flow",
  status: "in_progress",
  priority: 1,
  assigned_agent_id: "agent-1",
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

const agent: Agent = {
  id: "agent-1",
  crew_id: "crew-1",
  name: "Dev Bot",
  role: "developer",
  expertise: ["TypeScript"],
  system_prompt: "You are a developer",
  can_review: false,
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

describe("buildAgentPrompt", () => {
  it("includes issue title and description", () => {
    const prompt = buildAgentPrompt(issue, agent, repo, { worktreePath: "/tmp/work" });
    expect(prompt).toContain("Add login feature");
    expect(prompt).toContain("Implement OAuth2 login flow");
  });

  it("includes repo name and worktree path", () => {
    const prompt = buildAgentPrompt(issue, agent, repo, { worktreePath: "/tmp/worktrees/branch" });
    expect(prompt).toContain("myrepo");
    expect(prompt).toContain("/tmp/worktrees/branch");
  });

  it("includes instructions with crewdeck CLI commands", () => {
    const prompt = buildAgentPrompt(issue, agent, repo, { worktreePath: "/tmp/work" });
    expect(prompt).toContain("crewdeck signal --event work-complete");
    expect(prompt).toContain("crewdeck comment --message");
    expect(prompt).toContain("crewdeck files --modified");
  });

  it("includes agent name and role in instructions", () => {
    const prompt = buildAgentPrompt(issue, agent, repo, { worktreePath: "/tmp/work" });
    expect(prompt).toContain("Dev Bot");
    expect(prompt).toContain("developer");
  });

  it("includes previous comments when provided", () => {
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
    const prompt = buildAgentPrompt(issue, agent, repo, {
      worktreePath: "/tmp/work",
      previousComments: comments,
    });
    expect(prompt).toContain("Previous Comments");
    expect(prompt).toContain("Please fix the redirect");
  });

  it("includes feedback comments under review feedback section", () => {
    const feedback: Comment[] = [
      {
        id: "c2",
        issue_id: "issue-1",
        author_type: "agent",
        author_id: "reviewer-1",
        content: "Handle the error case",
        created_at: "2026-01-01",
      },
    ];
    const prompt = buildAgentPrompt(issue, agent, repo, {
      worktreePath: "/tmp/work",
      feedbackComments: feedback,
    });
    expect(prompt).toContain("Review Feedback to Address");
    expect(prompt).toContain("Handle the error case");
  });

  it("omits comment sections when no comments provided", () => {
    const prompt = buildAgentPrompt(issue, agent, repo, { worktreePath: "/tmp/work" });
    expect(prompt).not.toContain("Previous Comments");
    expect(prompt).not.toContain("Review Feedback");
  });
});
