import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import { eventBus } from "../../src/events/bus.js";
import { initActivityLogger } from "../../src/events/activity-logger.js";
import type { Issue, Comment, IssuePR } from "../../src/events/types.js";

const PROJECT_ID = "proj-test";
const ISSUE_ID = "issue-test";

beforeAll(() => {
  // Seed required foreign key rows
  db.prepare("INSERT INTO Project (id, name) VALUES (?, ?)").run(PROJECT_ID, "Test Project");
  db.prepare(
    "INSERT INTO Issue (id, project_id, title, description, status, created_by) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(ISSUE_ID, PROJECT_ID, "Test Issue", "desc", "open", "user");

  initActivityLogger();
});

beforeEach(() => {
  db.prepare("DELETE FROM ActivityLog").run();
});

function getLog() {
  return db.prepare("SELECT * FROM ActivityLog ORDER BY created_at").all() as Array<{
    id: string;
    project_id: string;
    issue_id: string | null;
    actor_type: string;
    actor_id: string | null;
    action: string;
    details: string | null;
  }>;
}

const baseIssue: Issue = {
  id: ISSUE_ID,
  project_id: PROJECT_ID,
  title: "Test Issue",
  description: "desc",
  status: "open",
  priority: 0,
  assigned_agent_id: null,
  created_by: "user",
  max_review_rounds: null,
  current_review_round: 0,
  branch_name: null,
  worktree_path: null,
  base_branch: null,
  repo_id: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("ActivityLogger", () => {
  it("logs issue.created with actor_type from issue.created_by", () => {
    eventBus.emit("issue.created", { issue: baseIssue });
    const logs = getLog();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      project_id: PROJECT_ID,
      issue_id: ISSUE_ID,
      actor_type: "user",
      action: "issue.created",
    });
    expect(JSON.parse(logs[0].details!)).toEqual({ title: "Test Issue" });
  });

  it("logs issue.created with orchestrator actor_type", () => {
    eventBus.emit("issue.created", {
      issue: { ...baseIssue, created_by: "orchestrator" },
    });
    const logs = getLog();
    expect(logs[0].actor_type).toBe("orchestrator");
  });

  it("logs issue.status_changed", () => {
    eventBus.emit("issue.status_changed", {
      issue_id: ISSUE_ID,
      project_id: PROJECT_ID,
      from: "open",
      to: "in_progress",
    });
    const logs = getLog();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      project_id: PROJECT_ID,
      issue_id: ISSUE_ID,
      actor_type: "system",
      action: "issue.status_changed",
    });
    expect(JSON.parse(logs[0].details!)).toEqual({ from: "open", to: "in_progress" });
  });

  it("logs issue.assigned as agent.assigned", () => {
    eventBus.emit("issue.assigned", {
      issue_id: ISSUE_ID,
      project_id: PROJECT_ID,
      agent_id: "agent-1",
      agent_name: "Alice",
    });
    const logs = getLog();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      project_id: PROJECT_ID,
      issue_id: ISSUE_ID,
      actor_type: "orchestrator",
      action: "agent.assigned",
    });
    expect(JSON.parse(logs[0].details!)).toEqual({ agent_id: "agent-1", agent_name: "Alice" });
  });

  it("logs comment.added with author info and content preview", () => {
    const comment: Comment = {
      id: "c1",
      issue_id: ISSUE_ID,
      author_type: "user",
      author_id: "u1",
      content: "Hello world",
      created_at: new Date().toISOString(),
    };
    eventBus.emit("comment.added", { comment, project_id: PROJECT_ID });
    const logs = getLog();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      project_id: PROJECT_ID,
      issue_id: ISSUE_ID,
      actor_type: "user",
      actor_id: "u1",
      action: "comment.added",
    });
    expect(JSON.parse(logs[0].details!)).toEqual({ content_preview: "Hello world" });
  });

  it("truncates comment content_preview to 200 chars", () => {
    const longContent = "x".repeat(300);
    const comment: Comment = {
      id: "c2",
      issue_id: ISSUE_ID,
      author_type: "agent",
      author_id: null,
      content: longContent,
      created_at: new Date().toISOString(),
    };
    eventBus.emit("comment.added", { comment, project_id: PROJECT_ID });
    const logs = getLog();
    const details = JSON.parse(logs[0].details!);
    expect(details.content_preview).toHaveLength(200);
  });

  it("logs session.started", () => {
    eventBus.emit("session.started", {
      session_id: "s1",
      agent_id: "a1",
      issue_id: ISSUE_ID,
      project_id: PROJECT_ID,
      tmux_session_name: "tmux-1",
    });
    const logs = getLog();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      project_id: PROJECT_ID,
      issue_id: ISSUE_ID,
      actor_type: "system",
      action: "session.started",
    });
    expect(JSON.parse(logs[0].details!)).toEqual({ agent_id: "a1", tmux_session_name: "tmux-1" });
  });

  it("logs session.ended", () => {
    eventBus.emit("session.ended", {
      session_id: "s1",
      project_id: PROJECT_ID,
      status: "completed",
    });
    const logs = getLog();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      project_id: PROJECT_ID,
      actor_type: "system",
      action: "session.ended",
    });
    expect(JSON.parse(logs[0].details!)).toEqual({ status: "completed" });
  });

  it("logs pr.created", () => {
    const issuePr: IssuePR = {
      id: "pr1",
      issue_id: ISSUE_ID,
      repo_id: "repo1",
      pr_number: 42,
      pr_url: "https://github.com/owner/repo/pull/42",
      status: "open",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    eventBus.emit("pr.created", { issue_pr: issuePr, project_id: PROJECT_ID });
    const logs = getLog();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      project_id: PROJECT_ID,
      issue_id: ISSUE_ID,
      actor_type: "user",
      action: "pr.created",
    });
    expect(JSON.parse(logs[0].details!)).toEqual({
      pr_number: 42,
      pr_url: "https://github.com/owner/repo/pull/42",
    });
  });

  it("unsubscribed events are not logged", () => {
    // Events not subscribed to by activity logger should produce no logs
    eventBus.emit("agent.idle", { agent_id: "a1", project_id: PROJECT_ID });
    expect(getLog()).toHaveLength(0);
  });
});
