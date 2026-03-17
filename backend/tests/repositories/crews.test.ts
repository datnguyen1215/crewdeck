import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import { createProject } from "../../src/db/repositories/projects.js";
import {
  getCrew,
  getCrewWithAgents,
  updateCrew,
} from "../../src/db/repositories/crews.js";
import { createAgent } from "../../src/db/repositories/agents.js";

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

describe("getCrew", () => {
  it("returns null for missing project", () => {
    expect(getCrew("missing")).toBeNull();
  });

  it("returns crew for project", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id);
    expect(crew).not.toBeNull();
    expect(crew!.project_id).toBe(p.id);
  });
});

describe("getCrewWithAgents", () => {
  it("returns crew with agents", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    createAgent(crew.id, {
      name: "Alice",
      title: "dev",
      system_prompt: "you are alice",
    });
    createAgent(crew.id, {
      name: "Bob",
      title: "reviewer",
      system_prompt: "you are bob",
    });

    const result = getCrewWithAgents(p.id);
    expect(result).not.toBeNull();
    expect(result!.agents.length).toBe(3); // 1 auto-captain + 2 manual
  });

  it("returns null when project not found", () => {
    expect(getCrewWithAgents("missing")).toBeNull();
  });
});

describe("updateCrew", () => {
  it("updates crew name", () => {
    const p = createProject({ name: "OldName" });
    const updated = updateCrew(p.id, { name: "NewName" });
    expect(updated.name).toBe("NewName");
  });
});
