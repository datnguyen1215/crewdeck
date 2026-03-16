import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import { createProject } from "../../src/db/repositories/projects.js";
import { getCrew } from "../../src/db/repositories/crews.js";
import { createAgent } from "../../src/db/repositories/agents.js";
import { createIssue } from "../../src/db/repositories/issues.js";
import {
  listIssueAgents,
  getIssueAgent,
  createIssueAgent,
  updateIssueAgent,
} from "../../src/db/repositories/issue-agents.js";

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

describe("createIssueAgent", () => {
  it("creates with defaults", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, { name: "A", title: "dev", system_prompt: "s" });
    const issue = createIssue(p.id, { title: "T", description: "D" });

    const ia = createIssueAgent({ issue_id: issue.id, agent_id: agent.id, role: "developer" });
    expect(ia.id).toBeTruthy();
    expect(ia.status).toBe("pending");
    expect(ia.review_order).toBeNull();
    expect(ia.session_id).toBeNull();
  });
});

describe("updateIssueAgent", () => {
  it("updates status", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, { name: "A", title: "dev", system_prompt: "s" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const ia = createIssueAgent({ issue_id: issue.id, agent_id: agent.id, role: "developer" });

    const updated = updateIssueAgent(ia.id, { status: "in_progress" });
    expect(updated.status).toBe("in_progress");
  });

  it("updates review_order", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, { name: "A", title: "dev", system_prompt: "s" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const ia = createIssueAgent({ issue_id: issue.id, agent_id: agent.id, role: "reviewer" });

    const updated = updateIssueAgent(ia.id, { review_order: 2 });
    expect(updated.review_order).toBe(2);
  });
});

describe("listIssueAgents", () => {
  it("returns agents for issue", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const a1 = createAgent(crew.id, { name: "A1", title: "dev", system_prompt: "s" });
    const a2 = createAgent(crew.id, { name: "A2", title: "reviewer", system_prompt: "s" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    createIssueAgent({ issue_id: issue.id, agent_id: a1.id, role: "developer" });
    createIssueAgent({ issue_id: issue.id, agent_id: a2.id, role: "reviewer" });

    expect(listIssueAgents(issue.id).length).toBe(2);
  });
});

describe("getIssueAgent", () => {
  it("returns null for missing id", () => {
    expect(getIssueAgent("missing")).toBeNull();
  });
});
