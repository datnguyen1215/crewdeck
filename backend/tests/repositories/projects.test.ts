import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
} from "../../src/db/repositories/projects.js";
import { getCrew } from "../../src/db/repositories/crews.js";

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

describe("createProject", () => {
  it("creates a project with defaults", () => {
    const p = createProject({ name: "Test" });
    expect(p.id).toBeTruthy();
    expect(p.name).toBe("Test");
    expect(p.description).toBeNull();
    expect(p.max_concurrency).toBe(1);
    expect(p.max_review_rounds).toBe(3);
  });

  it("creates a project with all fields", () => {
    const p = createProject({
      name: "Full",
      description: "desc",
      max_concurrency: 4,
      max_review_rounds: 5,
    });
    expect(p.description).toBe("desc");
    expect(p.max_concurrency).toBe(4);
    expect(p.max_review_rounds).toBe(5);
  });

  it("auto-creates a crew for the project (atomic)", () => {
    const p = createProject({ name: "WithCrew" });
    const crew = getCrew(p.id);
    expect(crew).not.toBeNull();
    expect(crew!.project_id).toBe(p.id);
    expect(crew!.name).toBe("WithCrew");
  });
});

describe("getProject", () => {
  it("returns null for missing id", () => {
    expect(getProject("missing")).toBeNull();
  });

  it("returns the project by id", () => {
    const p = createProject({ name: "Get" });
    expect(getProject(p.id)?.name).toBe("Get");
  });
});

describe("listProjects", () => {
  it("returns all projects", () => {
    createProject({ name: "A" });
    createProject({ name: "B" });
    expect(listProjects().length).toBe(2);
  });
});

describe("updateProject", () => {
  it("updates name", () => {
    const p = createProject({ name: "Old" });
    const updated = updateProject(p.id, { name: "New" });
    expect(updated.name).toBe("New");
  });

  it("updates only specified fields", () => {
    const p = createProject({ name: "Orig", max_concurrency: 2 });
    const updated = updateProject(p.id, { description: "hi" });
    expect(updated.name).toBe("Orig");
    expect(updated.description).toBe("hi");
    expect(updated.max_concurrency).toBe(2);
  });

  it("sets orchestrator_session_id", () => {
    const p = createProject({ name: "P" });
    const updated = updateProject(p.id, { orchestrator_session_id: "sess-123" });
    expect(updated.orchestrator_session_id).toBe("sess-123");
  });
});

describe("deleteProject", () => {
  it("deletes the project", () => {
    const p = createProject({ name: "Del" });
    deleteProject(p.id);
    expect(getProject(p.id)).toBeNull();
  });

  it("cascades to crew", () => {
    const p = createProject({ name: "Cascade" });
    expect(getCrew(p.id)).not.toBeNull();
    deleteProject(p.id);
    expect(getCrew(p.id)).toBeNull();
  });
});
