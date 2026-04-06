import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
} from "../../src/db/repositories/projects.js";

function clearAll() {
  db.exec("DELETE FROM ActivityLog");
  db.exec("DELETE FROM IssuePR");
  db.exec("DELETE FROM Comment");
  db.exec("DELETE FROM Issue");
  db.exec("DELETE FROM Repo");
  db.exec("DELETE FROM Project");
}

beforeEach(clearAll);

describe("createProject", () => {
  it("creates a project with defaults", () => {
    const p = createProject({ name: "Test" });
    expect(p.id).toBeTruthy();
    expect(p.name).toBe("Test");
    expect(p.description).toBeNull();
  });

  it("creates a project with all fields", () => {
    const p = createProject({
      name: "Full",
      description: "desc",
    });
    expect(p.description).toBe("desc");
  });

  it("defaults default_base_branch to 'main' when not provided", () => {
    const p = createProject({ name: "DefaultBranch" });
    expect(p.default_base_branch).toBe("main");
  });

  it("uses provided default_base_branch", () => {
    const p = createProject({ name: "DevelopBranch", default_base_branch: "develop" });
    expect(p.default_base_branch).toBe("develop");
  });

  it("uses 'main' as default_base_branch when explicitly passed 'main'", () => {
    const p = createProject({ name: "MainBranch", default_base_branch: "main" });
    expect(p.default_base_branch).toBe("main");
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
    const p = createProject({ name: "Orig" });
    const updated = updateProject(p.id, { description: "hi" });
    expect(updated.name).toBe("Orig");
    expect(updated.description).toBe("hi");
  });
});

describe("deleteProject", () => {
  it("deletes the project", () => {
    const p = createProject({ name: "Del" });
    deleteProject(p.id);
    expect(getProject(p.id)).toBeNull();
  });
});
