import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import { eventBus } from "../../src/events/bus.js";
import { initActivityLogger } from "../../src/events/activity-logger.js";
import type { Comment, IssuePR } from "../../src/types/entities.js";

const PROJECT_ID = "proj-test";
const ISSUE_ID = "issue-test";

beforeAll(() => {
  // Seed required foreign key rows
  db.prepare("INSERT INTO Project (id, name) VALUES (?, ?)").run(
    PROJECT_ID,
    "Test Project",
  );
  db.prepare(
    "INSERT INTO Issue (id, project_id, title, description, status, created_by) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(ISSUE_ID, PROJECT_ID, "Test Issue", "desc", "open", "user");

  initActivityLogger();
});

beforeEach(() => {
  db.prepare("DELETE FROM ActivityLog").run();
});

function getLog() {
  return db
    .prepare("SELECT * FROM ActivityLog ORDER BY created_at")
    .all() as Array<{
    id: string;
    project_id: string;
    issue_id: string | null;
    actor_type: string;
    actor_id: string | null;
    action: string;
    details: string | null;
  }>;
}

const baseIssue = {
  id: ISSUE_ID,
  project_id: PROJECT_ID,
  title: "Test Issue",
  description: "desc",
  status: "open",
  created_by: "user",
  chain_depth: 0,
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

  it("logs issue.created with agent actor_type", () => {
    eventBus.emit("issue.created", {
      issue: { ...baseIssue, created_by: "agent" },
    });
    const logs = getLog();
    expect(logs[0].actor_type).toBe("agent");
  });

  it("treats unknown created_by as agent and stores it as actor_id", () => {
    eventBus.emit("issue.created", {
      issue: { ...baseIssue, created_by: "custom-agent" },
    });
    const logs = getLog();
    // Non-user/system values are treated as agent IDs
    expect(logs[0].actor_type).toBe("agent");
    expect(logs[0].actor_id).toBe("custom-agent");
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
    expect(JSON.parse(logs[0].details!)).toEqual({
      from: "open",
      to: "in_progress",
    });
  });

  it("logs comment.added with author info and content preview", () => {
    const comment: Comment = {
      id: "c1",
      issue_id: ISSUE_ID,
      author_type: "user",
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
      actor_id: null,
      action: "comment.added",
    });
    expect(JSON.parse(logs[0].details!)).toEqual({
      content_preview: "Hello world",
    });
  });

  it("logs comment.added from agent with author_type as actor_id", () => {
    const comment: Comment = {
      id: "c2",
      issue_id: ISSUE_ID,
      author_type: "engineer",
      content: "Agent comment",
      created_at: new Date().toISOString(),
    };
    eventBus.emit("comment.added", { comment, project_id: PROJECT_ID });
    const logs = getLog();
    expect(logs[0]).toMatchObject({
      actor_type: "agent",
      actor_id: "engineer",
    });
  });

  it("truncates comment content_preview to 200 chars", () => {
    const longContent = "x".repeat(300);
    const comment: Comment = {
      id: "c3",
      issue_id: ISSUE_ID,
      author_type: "captain",
      content: longContent,
      created_at: new Date().toISOString(),
    };
    eventBus.emit("comment.added", { comment, project_id: PROJECT_ID });
    const logs = getLog();
    const details = JSON.parse(logs[0].details!);
    expect(details.content_preview).toHaveLength(200);
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

  it("logs mention.spawned", () => {
    eventBus.emit("mention.spawned", {
      project_id: PROJECT_ID,
      issue_id: ISSUE_ID,
      agent_id: "a1",
      pid: 1234,
    });
    const logs = getLog();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      project_id: PROJECT_ID,
      issue_id: ISSUE_ID,
      actor_type: "agent",
      actor_id: "a1",
      action: "mention.spawned",
    });
    expect(JSON.parse(logs[0].details!)).toEqual({ agent_id: "a1", pid: 1234 });
  });

  it("logs mention.completed", () => {
    eventBus.emit("mention.completed", {
      project_id: PROJECT_ID,
      issue_id: ISSUE_ID,
      agent_id: "a1",
      exit_code: 0,
    });
    const logs = getLog();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      project_id: PROJECT_ID,
      issue_id: ISSUE_ID,
      actor_type: "agent",
      actor_id: "a1",
      action: "mention.completed",
    });
    expect(JSON.parse(logs[0].details!)).toEqual({
      agent_id: "a1",
      exit_code: 0,
    });
  });

  it("unsubscribed events are not logged", () => {
    // Events not subscribed to by activity logger should produce no logs
    eventBus.emit("pr.status_changed", {
      pr_id: "pr1",
      project_id: PROJECT_ID,
      from: "open",
      to: "closed",
    });
    expect(getLog()).toHaveLength(0);
  });

  it("logs dispatch.queued as agent.queued", () => {
    eventBus.emit("dispatch.queued", {
      project_id: PROJECT_ID,
      issue_id: ISSUE_ID,
      agent_id: "engineer",
      position: 2,
    });
    const logs = getLog();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      project_id: PROJECT_ID,
      issue_id: ISSUE_ID,
      actor_type: "agent",
      actor_id: "engineer",
      action: "agent.queued",
    });
    expect(JSON.parse(logs[0].details!)).toEqual({
      agent_id: "engineer",
      position: 2,
    });
  });

  it("logs dispatch.dequeued as agent.dequeued", () => {
    eventBus.emit("dispatch.dequeued", {
      project_id: PROJECT_ID,
      issue_id: ISSUE_ID,
      agent_id: "captain",
    });
    const logs = getLog();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      project_id: PROJECT_ID,
      issue_id: ISSUE_ID,
      actor_type: "agent",
      actor_id: "captain",
      action: "agent.dequeued",
    });
    expect(JSON.parse(logs[0].details!)).toEqual({ agent_id: "captain" });
  });
});
