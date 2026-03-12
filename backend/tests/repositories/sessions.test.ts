import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import { createProject } from "../../src/db/repositories/projects.js";
import {
  listSessions,
  listRunningSessions,
  getSession,
  createSession,
  updateSession,
} from "../../src/db/repositories/sessions.js";

function clearAll() {
  db.exec("DELETE FROM ActivityLog");
  db.exec("DELETE FROM IssueAgent");
  db.exec("DELETE FROM IssuePR");
  db.exec("DELETE FROM Comment");
  db.exec("DELETE FROM Session");
  db.exec("DELETE FROM Issue");
  db.exec("DELETE FROM Agent");
  db.exec("DELETE FROM Repo");
  db.exec("DELETE FROM Crew");
  db.exec("DELETE FROM Project");
}

beforeEach(clearAll);

describe("createSession", () => {
  it("creates session with defaults", () => {
    const p = createProject({ name: "P" });
    const session = createSession({ project_id: p.id, session_type: "orchestrator" });
    expect(session.id).toBeTruthy();
    expect(session.status).toBe("idle");
    expect(session.agent_id).toBeNull();
    expect(session.context).toBeNull();
  });

  it("stores and parses context JSON", () => {
    const p = createProject({ name: "P" });
    const session = createSession({
      project_id: p.id,
      session_type: "agent",
      context: { key: "value", num: 42 },
    });
    expect(session.context).toEqual({ key: "value", num: 42 });
  });
});

describe("updateSession", () => {
  it("updates status", () => {
    const p = createProject({ name: "P" });
    const session = createSession({ project_id: p.id, session_type: "orchestrator" });
    const updated = updateSession(session.id, { status: "active" });
    expect(updated.status).toBe("active");
  });

  it("nulls out agent_id", () => {
    const p = createProject({ name: "P" });
    const session = createSession({ project_id: p.id, session_type: "agent" });
    const updated = updateSession(session.id, { agent_id: null });
    expect(updated.agent_id).toBeNull();
  });

  it("updates context", () => {
    const p = createProject({ name: "P" });
    const session = createSession({ project_id: p.id, session_type: "agent" });
    const updated = updateSession(session.id, { context: { step: 2 } });
    expect(updated.context).toEqual({ step: 2 });
  });
});

describe("listSessions", () => {
  it("filters by status", () => {
    const p = createProject({ name: "P" });
    createSession({ project_id: p.id, session_type: "orchestrator", status: "idle" });
    createSession({ project_id: p.id, session_type: "agent", status: "active" });

    expect(listSessions(p.id, { status: "active" }).length).toBe(1);
  });

  it("filters by session_type", () => {
    const p = createProject({ name: "P" });
    createSession({ project_id: p.id, session_type: "orchestrator" });
    createSession({ project_id: p.id, session_type: "agent" });

    expect(listSessions(p.id, { session_type: "agent" }).length).toBe(1);
  });
});

describe("getSession", () => {
  it("returns null for missing id", () => {
    expect(getSession("missing")).toBeNull();
  });
});

describe("listRunningSessions", () => {
  it("returns only sessions with status running, across all projects", () => {
    const p1 = createProject({ name: "P1" });
    const p2 = createProject({ name: "P2" });
    createSession({ project_id: p1.id, session_type: "agent", status: "running" });
    createSession({ project_id: p1.id, session_type: "agent", status: "completed" });
    createSession({ project_id: p2.id, session_type: "orchestrator", status: "running" });

    const running = listRunningSessions();
    expect(running.length).toBe(2);
    expect(running.every((s) => s.status === "running")).toBe(true);
  });

  it("returns empty array when no running sessions", () => {
    const p = createProject({ name: "P" });
    createSession({ project_id: p.id, session_type: "agent", status: "completed" });

    expect(listRunningSessions()).toHaveLength(0);
  });
});
