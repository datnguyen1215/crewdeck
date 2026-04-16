import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import { createProject } from "../../src/db/repositories/projects.js";
import { createIssue } from "../../src/db/repositories/issues.js";
import {
  upsertSession,
  getSession,
  deleteByIssue,
  deleteByProject,
  listByIssue,
} from "../../src/db/repositories/agent-sessions.js";

function clearAll() {
  db.exec("DELETE FROM AgentSession");
  db.exec("DELETE FROM ActivityLog");
  db.exec("DELETE FROM IssuePR");
  db.exec("DELETE FROM Comment");
  db.exec("DELETE FROM Issue");
  db.exec("DELETE FROM Repo");
  db.exec("DELETE FROM Project");
}

beforeEach(clearAll);

describe("upsertSession", () => {
  it("inserts a new session", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const session = upsertSession(p.id, issue.id, "engineer", "sess-abc");
    expect(session.project_id).toBe(p.id);
    expect(session.issue_id).toBe(issue.id);
    expect(session.agent_id).toBe("engineer");
    expect(session.session_id).toBe("sess-abc");
    expect(session.created_at).toBeTruthy();
    expect(session.updated_at).toBeTruthy();
  });

  it("updates session_id on conflict", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    upsertSession(p.id, issue.id, "engineer", "sess-abc");
    const updated = upsertSession(p.id, issue.id, "engineer", "sess-xyz");
    expect(updated.session_id).toBe("sess-xyz");
  });
});

describe("getSession", () => {
  it("returns null for missing session", () => {
    expect(getSession("proj", "issue", "agent")).toBeNull();
  });

  it("returns session by composite key", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    upsertSession(p.id, issue.id, "engineer", "sess-123");
    const found = getSession(p.id, issue.id, "engineer");
    expect(found?.session_id).toBe("sess-123");
  });
});

describe("deleteByIssue", () => {
  it("removes all sessions for an issue", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    upsertSession(p.id, issue.id, "engineer", "s1");
    upsertSession(p.id, issue.id, "inspector", "s2");
    deleteByIssue(issue.id);
    expect(listByIssue(issue.id)).toHaveLength(0);
  });
});

describe("deleteByProject", () => {
  it("removes all sessions for a project", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    upsertSession(p.id, issue.id, "engineer", "s1");
    deleteByProject(p.id);
    expect(getSession(p.id, issue.id, "engineer")).toBeNull();
  });
});

describe("listByIssue", () => {
  it("lists all sessions for an issue", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    upsertSession(p.id, issue.id, "engineer", "s1");
    upsertSession(p.id, issue.id, "inspector", "s2");
    const sessions = listByIssue(issue.id);
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.agent_id).sort()).toEqual(["engineer", "inspector"]);
  });
});
