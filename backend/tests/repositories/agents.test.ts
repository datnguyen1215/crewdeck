import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import { createProject } from "../../src/db/repositories/projects.js";
import {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
} from "../../src/db/repositories/agents.js";

function clearAll() {
  db.exec("DELETE FROM ActivityLog");
  db.exec("DELETE FROM IssuePR");
  db.exec("DELETE FROM Comment");
  db.exec("DELETE FROM Issue");
  db.exec("DELETE FROM Agent");
  db.exec("DELETE FROM Repo");
  db.exec("DELETE FROM Project");
}

beforeEach(clearAll);

describe("createAgent", () => {
  it("creates agent with defaults", () => {
    const p = createProject({ name: "P" });
    const agent = createAgent(p.id, {
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
    const agent = createAgent(p.id, {
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
    const agent = createAgent(p.id, {
      name: "Old",
      title: "Dev",
      system_prompt: "s",
    });
    const updated = updateAgent(agent.id, { name: "New", title: "Reviewer" });
    expect(updated.name).toBe("New");
    expect(updated.title).toBe("Reviewer");
  });

  it("updates description", () => {
    const p = createProject({ name: "P" });
    const agent = createAgent(p.id, {
      name: "A",
      title: "Dev",
      system_prompt: "s",
    });
    const updated = updateAgent(agent.id, { description: "Updated desc" });
    expect(updated.description).toBe("Updated desc");
  });
});

describe("deleteAgent", () => {
  it("deletes the agent", () => {
    const p = createProject({ name: "P" });
    const agent = createAgent(p.id, {
      name: "A",
      title: "Dev",
      system_prompt: "s",
    });
    deleteAgent(agent.id);
    expect(getAgent(agent.id)).toBeNull();
  });
});

describe("listAgents", () => {
  it("returns agents for project", () => {
    const p = createProject({ name: "P" });
    createAgent(p.id, { name: "A", title: "Dev", system_prompt: "s" });
    createAgent(p.id, { name: "B", title: "Dev", system_prompt: "s" });
    expect(listAgents(p.id).length).toBe(2);
  });
});
