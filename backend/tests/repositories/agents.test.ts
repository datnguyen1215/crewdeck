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
import { createSession } from "../../src/db/repositories/sessions.js";

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
      title: "Senior Developer",
      system_prompt: "you are alice",
    });
    expect(agent.id).toBeTruthy();
    expect(agent.name).toBe("Alice");
    expect(agent.title).toBe("Senior Developer");
    expect(agent.description).toBeNull();
  });

  it("stores description", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, {
      name: "Expert",
      title: "Specialist",
      system_prompt: "you are an expert",
      description: "Handles complex backend tasks",
    });
    expect(agent.description).toBe("Handles complex backend tasks");
  });
});

describe("updateAgent", () => {
  it("updates name and title", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, { name: "Old", title: "Dev", system_prompt: "s" });
    const updated = updateAgent(agent.id, { name: "New", title: "Reviewer" });
    expect(updated.name).toBe("New");
    expect(updated.title).toBe("Reviewer");
  });

  it("updates description", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, { name: "A", title: "Dev", system_prompt: "s" });
    const updated = updateAgent(agent.id, { description: "Updated desc" });
    expect(updated.description).toBe("Updated desc");
  });
});

describe("deleteAgent", () => {
  it("deletes the agent", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, { name: "A", title: "Dev", system_prompt: "s" });
    deleteAgent(agent.id);
    expect(getAgent(agent.id)).toBeNull();
  });

  it("nulls out agent_id on sessions instead of deleting them", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, { name: "A", title: "Dev", system_prompt: "s" });
    createSession({ project_id: p.id, session_type: "agent", agent_id: agent.id });
    deleteAgent(agent.id);
    expect(getAgent(agent.id)).toBeNull();
    const sessions = db.prepare("SELECT * FROM Session WHERE project_id = ?").all(p.id) as { agent_id: string | null }[];
    expect(sessions.length).toBe(1);
    expect(sessions[0].agent_id).toBeNull();
  });
});

describe("listAgents", () => {
  it("returns agents for crew", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    createAgent(crew.id, { name: "A", title: "Dev", system_prompt: "s" });
    createAgent(crew.id, { name: "B", title: "Dev", system_prompt: "s" });
    expect(listAgents(crew.id).length).toBe(2);
  });
});

describe("hasActiveIssues", () => {
  it("returns false when agent has no issues", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, { name: "A", title: "Dev", system_prompt: "s" });
    expect(hasActiveIssues(agent.id)).toBe(false);
  });

  it("returns true when agent has open issue", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, { name: "A", title: "Dev", system_prompt: "s" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    updateIssue(issue.id, { assigned_agent_id: agent.id });
    expect(hasActiveIssues(agent.id)).toBe(true);
  });

  it("returns false when agent's issue is closed", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, { name: "A", title: "Dev", system_prompt: "s" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    updateIssue(issue.id, { assigned_agent_id: agent.id, status: "closed" });
    expect(hasActiveIssues(agent.id)).toBe(false);
  });

  it("returns false when agent's issue is done", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, { name: "A", title: "Dev", system_prompt: "s" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    updateIssue(issue.id, { assigned_agent_id: agent.id, status: "done" });
    expect(hasActiveIssues(agent.id)).toBe(false);
  });
});
