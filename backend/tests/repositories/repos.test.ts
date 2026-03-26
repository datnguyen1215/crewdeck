import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import { createProject } from "../../src/db/repositories/projects.js";
import { listRepos, getRepo, createRepo, deleteRepo } from "../../src/db/repositories/repos.js";

function clearAll() {
  db.exec("DELETE FROM ActivityLog");
  db.exec("DELETE FROM IssuePR");
  db.exec("DELETE FROM Comment");
  db.exec("DELETE FROM Issue");
  db.exec("DELETE FROM Repo");
  db.exec("DELETE FROM Project");
}

beforeEach(clearAll);

describe("createRepo", () => {
  it("parses owner and name from https URL", () => {
    const p = createProject({ name: "P" });
    const repo = createRepo(p.id, {
      repo_url: "https://github.com/acme/widget",
    });
    expect(repo.owner).toBe("acme");
    expect(repo.name).toBe("widget");
    expect(repo.default_branch).toBe("main");
    expect(repo.local_path).toContain("acme/widget");
  });

  it("parses owner and name from ssh URL", () => {
    const p = createProject({ name: "P" });
    const repo = createRepo(p.id, {
      repo_url: "git@github.com:acme/widget.git",
    });
    expect(repo.owner).toBe("acme");
    expect(repo.name).toBe("widget");
  });

  it("respects custom default_branch", () => {
    const p = createProject({ name: "P" });
    const repo = createRepo(p.id, {
      repo_url: "https://github.com/acme/widget",
      default_branch: "develop",
    });
    expect(repo.default_branch).toBe("develop");
  });
});

describe("listRepos", () => {
  it("returns repos for the project", () => {
    const p = createProject({ name: "P" });
    createRepo(p.id, { repo_url: "https://github.com/acme/a" });
    createRepo(p.id, { repo_url: "https://github.com/acme/b" });
    expect(listRepos(p.id).length).toBe(2);
  });

  it("does not return repos from other projects", () => {
    const p1 = createProject({ name: "P1" });
    const p2 = createProject({ name: "P2" });
    createRepo(p1.id, { repo_url: "https://github.com/a/x" });
    expect(listRepos(p2.id).length).toBe(0);
  });
});

describe("getRepo", () => {
  it("returns null for missing id", () => {
    expect(getRepo("missing")).toBeNull();
  });
});

describe("deleteRepo", () => {
  it("deletes the repo", () => {
    const p = createProject({ name: "P" });
    const repo = createRepo(p.id, {
      repo_url: "https://github.com/acme/widget",
    });
    deleteRepo(repo.id);
    expect(getRepo(repo.id)).toBeNull();
  });
});
