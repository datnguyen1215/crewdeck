import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import { createProject } from "../../src/db/repositories/projects.js";
import { createIssue } from "../../src/db/repositories/issues.js";
import { listActivity, createActivity } from "../../src/db/repositories/activity-log.js";

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

describe("createActivity", () => {
  it("creates activity log entry", () => {
    const p = createProject({ name: "P" });
    const log = createActivity({
      project_id: p.id,
      actor_type: "user",
      action: "created_project",
    });
    expect(log.id).toBeTruthy();
    expect(log.action).toBe("created_project");
    expect(log.details).toBeNull();
  });

  it("stores and parses details JSON", () => {
    const p = createProject({ name: "P" });
    const log = createActivity({
      project_id: p.id,
      actor_type: "agent",
      action: "updated_issue",
      details: { old_status: "open", new_status: "closed" },
    });
    expect(log.details).toEqual({ old_status: "open", new_status: "closed" });
  });
});

describe("listActivity", () => {
  it("filters by issue_id", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    createActivity({ project_id: p.id, issue_id: issue.id, actor_type: "user", action: "commented" });
    createActivity({ project_id: p.id, actor_type: "user", action: "other" });

    const result = listActivity(p.id, { issue_id: issue.id });
    expect(result.length).toBe(1);
    expect(result[0].action).toBe("commented");
  });

  it("filters by actor_type", () => {
    const p = createProject({ name: "P" });
    createActivity({ project_id: p.id, actor_type: "user", action: "a" });
    createActivity({ project_id: p.id, actor_type: "agent", action: "b" });

    expect(listActivity(p.id, { actor_type: "agent" }).length).toBe(1);
  });

  it("filters by action", () => {
    const p = createProject({ name: "P" });
    createActivity({ project_id: p.id, actor_type: "user", action: "created" });
    createActivity({ project_id: p.id, actor_type: "user", action: "deleted" });

    expect(listActivity(p.id, { action: "created" }).length).toBe(1);
  });

  it("paginates with limit and offset", () => {
    const p = createProject({ name: "P" });
    for (let i = 0; i < 10; i++) {
      createActivity({ project_id: p.id, actor_type: "user", action: `action_${i}` });
    }

    const page1 = listActivity(p.id, { limit: 3, offset: 0 });
    expect(page1.length).toBe(3);

    const page2 = listActivity(p.id, { limit: 3, offset: 3 });
    expect(page2.length).toBe(3);

    // All unique
    const ids1 = new Set(page1.map((l) => l.id));
    const ids2 = new Set(page2.map((l) => l.id));
    expect([...ids1].filter((id) => ids2.has(id)).length).toBe(0);
  });

  it("defaults to limit 50", () => {
    const p = createProject({ name: "P" });
    for (let i = 0; i < 60; i++) {
      createActivity({ project_id: p.id, actor_type: "user", action: `a_${i}` });
    }
    expect(listActivity(p.id).length).toBe(50);
  });

  it("filters by since", () => {
    const p = createProject({ name: "P" });
    // Insert an old entry directly with a past timestamp
    db.prepare(
      "INSERT INTO ActivityLog (id, project_id, actor_type, action, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(crypto.randomUUID(), p.id, "user", "old_action", "2020-01-01 00:00:00");
    createActivity({ project_id: p.id, actor_type: "user", action: "new_action" });

    const result = listActivity(p.id, { since: "2021-01-01 00:00:00" });
    expect(result.every((l) => l.action !== "old_action")).toBe(true);
  });
});
