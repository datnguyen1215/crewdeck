import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import { createProject } from "../../src/db/repositories/projects.js";
import { createRepo } from "../../src/db/repositories/repos.js";
import { createIssue } from "../../src/db/repositories/issues.js";
import {
  listIssuePRs,
  getIssuePR,
  createIssuePR,
  updateIssuePR,
} from "../../src/db/repositories/issue-prs.js";

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

describe("createIssuePR", () => {
  it("creates with default status", () => {
    const p = createProject({ name: "P" });
    const repo = createRepo(p.id, { github_url: "https://github.com/acme/x", local_path: "/x" });
    const issue = createIssue(p.id, { title: "T", description: "D" });

    const pr = createIssuePR({
      issue_id: issue.id,
      repo_id: repo.id,
      pr_number: 1,
      pr_url: "https://github.com/acme/x/pull/1",
    });
    expect(pr.id).toBeTruthy();
    expect(pr.status).toBe("open");
    expect(pr.pr_number).toBe(1);
  });
});

describe("updateIssuePR", () => {
  it("updates status", () => {
    const p = createProject({ name: "P" });
    const repo = createRepo(p.id, { github_url: "https://github.com/acme/x", local_path: "/x" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const pr = createIssuePR({
      issue_id: issue.id,
      repo_id: repo.id,
      pr_number: 1,
      pr_url: "https://github.com/acme/x/pull/1",
    });

    const updated = updateIssuePR(pr.id, { status: "merged" });
    expect(updated.status).toBe("merged");
  });
});

describe("listIssuePRs", () => {
  it("returns PRs for issue", () => {
    const p = createProject({ name: "P" });
    const repo = createRepo(p.id, { github_url: "https://github.com/acme/x", local_path: "/x" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    createIssuePR({ issue_id: issue.id, repo_id: repo.id, pr_number: 1, pr_url: "https://github.com/acme/x/pull/1" });
    createIssuePR({ issue_id: issue.id, repo_id: repo.id, pr_number: 2, pr_url: "https://github.com/acme/x/pull/2" });

    expect(listIssuePRs(issue.id).length).toBe(2);
  });
});

describe("getIssuePR", () => {
  it("returns null for missing id", () => {
    expect(getIssuePR("missing")).toBeNull();
  });
});
