import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import { createProject } from "../../src/db/repositories/projects.js";
import { getCrew } from "../../src/db/repositories/crews.js";
import {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  hasActiveIssues,
} from "../../src/db/repositories/agents.js";
import { createIssue, updateIssue } from "../../src/db/repositories/issues.js";

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

describe("createAgent", () => {
  it("creates agent with defaults", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, {
      name: "Alice",
      role: "developer",
      system_prompt: "you are alice",
    });
    expect(agent.id).toBeTruthy();
    expect(agent.name).toBe("Alice");
    expect(agent.expertise).toEqual([]);
    expect(agent.can_review).toBe(true);
  });

  it("stores and parses expertise array", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, {
      name: "Expert",
      role: "specialist",
      system_prompt: "you are an expert",
      expertise: ["TypeScript", "Node.js"],
    });
    expect(agent.expertise).toEqual(["TypeScript", "Node.js"]);
  });

  it("respects can_review=false", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, {
      name: "Coder",
      role: "dev",
      system_prompt: "code",
      can_review: false,
    });
    expect(agent.can_review).toBe(false);
  });
});

describe("updateAgent", () => {
  it("updates name and role", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, { name: "Old", role: "dev", system_prompt: "s" });
    const updated = updateAgent(agent.id, { name: "New", role: "reviewer" });
    expect(updated.name).toBe("New");
    expect(updated.role).toBe("reviewer");
  });

  it("updates expertise", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, { name: "A", role: "dev", system_prompt: "s" });
    const updated = updateAgent(agent.id, { expertise: ["Go"] });
    expect(updated.expertise).toEqual(["Go"]);
  });
});

describe("deleteAgent", () => {
  it("deletes the agent", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, { name: "A", role: "dev", system_prompt: "s" });
    deleteAgent(agent.id);
    expect(getAgent(agent.id)).toBeNull();
  });
});

describe("listAgents", () => {
  it("returns agents for crew", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    createAgent(crew.id, { name: "A", role: "dev", system_prompt: "s" });
    createAgent(crew.id, { name: "B", role: "dev", system_prompt: "s" });
    expect(listAgents(crew.id).length).toBe(2);
  });
});

describe("hasActiveIssues", () => {
  it("returns false when agent has no issues", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, { name: "A", role: "dev", system_prompt: "s" });
    expect(hasActiveIssues(agent.id)).toBe(false);
  });

  it("returns true when agent has open issue", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, { name: "A", role: "dev", system_prompt: "s" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    updateIssue(issue.id, { assigned_agent_id: agent.id });
    expect(hasActiveIssues(agent.id)).toBe(true);
  });

  it("returns false when agent's issue is closed", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, { name: "A", role: "dev", system_prompt: "s" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    updateIssue(issue.id, { assigned_agent_id: agent.id, status: "closed" });
    expect(hasActiveIssues(agent.id)).toBe(false);
  });
});
