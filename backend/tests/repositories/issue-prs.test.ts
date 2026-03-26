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
  getIssuePRByRepoAndNumber,
  listOpenPRsWithContext,
} from "../../src/db/repositories/issue-prs.js";
import { createVCSAccount } from "../../src/db/repositories/vcs-accounts.js";
import { updateProject } from "../../src/db/repositories/projects.js";

function clearAll() {
  db.exec("DELETE FROM ActivityLog");
  db.exec("DELETE FROM IssuePR");
  db.exec("DELETE FROM Comment");
  db.exec("DELETE FROM Issue");
  db.exec("DELETE FROM Repo");
  db.exec("DELETE FROM Project");
  db.exec("DELETE FROM VCSAccount");
}

beforeEach(clearAll);

describe("createIssuePR", () => {
  it("creates with default status", () => {
    const p = createProject({ name: "P" });
    const repo = createRepo(p.id, { repo_url: "https://github.com/acme/x" });
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
    const repo = createRepo(p.id, { repo_url: "https://github.com/acme/x" });
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
    const repo = createRepo(p.id, { repo_url: "https://github.com/acme/x" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    createIssuePR({
      issue_id: issue.id,
      repo_id: repo.id,
      pr_number: 1,
      pr_url: "https://github.com/acme/x/pull/1",
    });
    createIssuePR({
      issue_id: issue.id,
      repo_id: repo.id,
      pr_number: 2,
      pr_url: "https://github.com/acme/x/pull/2",
    });

    expect(listIssuePRs(issue.id).length).toBe(2);
  });
});

describe("getIssuePR", () => {
  it("returns null for missing id", () => {
    expect(getIssuePR("missing")).toBeNull();
  });
});

describe("getIssuePRByRepoAndNumber", () => {
  it("returns null when no matching record exists", () => {
    const result = getIssuePRByRepoAndNumber("nonexistent-repo-id", 123);
    expect(result).toBeNull();
  });

  it("returns the correct record when it exists", () => {
    const p = createProject({ name: "P" });
    const repo = createRepo(p.id, { repo_url: "https://github.com/acme/x" });
    const issue = createIssue(p.id, { title: "T", description: "D" });

    const pr = createIssuePR({
      issue_id: issue.id,
      repo_id: repo.id,
      pr_number: 42,
      pr_url: "https://github.com/acme/x/pull/42",
    });

    const found = getIssuePRByRepoAndNumber(repo.id, 42);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(pr.id);
    expect(found!.pr_number).toBe(42);
    expect(found!.repo_id).toBe(repo.id);
  });

  it("returns null for different pr_number on same repo", () => {
    const p = createProject({ name: "P" });
    const repo = createRepo(p.id, { repo_url: "https://github.com/acme/x" });
    const issue = createIssue(p.id, { title: "T", description: "D" });

    createIssuePR({
      issue_id: issue.id,
      repo_id: repo.id,
      pr_number: 42,
      pr_url: "https://github.com/acme/x/pull/42",
    });

    const result = getIssuePRByRepoAndNumber(repo.id, 99);
    expect(result).toBeNull();
  });

  it("returns null for same pr_number on different repo", () => {
    const p = createProject({ name: "P" });
    const repo1 = createRepo(p.id, { repo_url: "https://github.com/acme/x" });
    const repo2 = createRepo(p.id, { repo_url: "https://github.com/acme/y" });
    const issue = createIssue(p.id, { title: "T", description: "D" });

    createIssuePR({
      issue_id: issue.id,
      repo_id: repo1.id,
      pr_number: 42,
      pr_url: "https://github.com/acme/x/pull/42",
    });

    const result = getIssuePRByRepoAndNumber(repo2.id, 42);
    expect(result).toBeNull();
  });
});

describe("listOpenPRsWithContext", () => {
  it("returns empty array when no open PRs exist", () => {
    const result = listOpenPRsWithContext();
    expect(result).toEqual([]);
  });

  it("returns empty array when only closed/merged PRs exist", () => {
    const p = createProject({ name: "P" });
    const repo = createRepo(p.id, { repo_url: "https://github.com/acme/x" });
    const issue = createIssue(p.id, { title: "T", description: "D" });

    const pr = createIssuePR({
      issue_id: issue.id,
      repo_id: repo.id,
      pr_number: 1,
      pr_url: "https://github.com/acme/x/pull/1",
      status: "open",
    });
    updateIssuePR(pr.id, { status: "merged" });

    const result = listOpenPRsWithContext();
    expect(result).toEqual([]);
  });

  it("returns open PRs with correct context fields", () => {
    const account = createVCSAccount({
      account_name: "testuser",
      username: "testuser",
      token: "gho_test123",
      ssh_private_key: "test-key",
    });
    const p = createProject({ name: "P", vcs_account_id: account.id });
    const repo = createRepo(p.id, {
      repo_url: "https://github.com/acme/myrepo",
    });
    const issue = createIssue(p.id, { title: "T", description: "D" });

    const pr = createIssuePR({
      issue_id: issue.id,
      repo_id: repo.id,
      pr_number: 123,
      pr_url: "https://github.com/acme/myrepo/pull/123",
    });

    const result = listOpenPRsWithContext();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: pr.id,
      issue_id: issue.id,
      repo_id: repo.id,
      pr_number: 123,
      pr_url: "https://github.com/acme/myrepo/pull/123",
      status: "open",
      repo_owner: "acme",
      repo_name: "myrepo",
      project_id: p.id,
      vcs_account_id: account.id,
    });
  });

  it("returns null vcs_account_id when project has no linked account", () => {
    const p = createProject({ name: "P" });
    const repo = createRepo(p.id, { repo_url: "https://github.com/acme/x" });
    const issue = createIssue(p.id, { title: "T", description: "D" });

    createIssuePR({
      issue_id: issue.id,
      repo_id: repo.id,
      pr_number: 1,
      pr_url: "https://github.com/acme/x/pull/1",
    });

    const result = listOpenPRsWithContext();
    expect(result).toHaveLength(1);
    expect(result[0].vcs_account_id).toBeNull();
  });

  it("returns multiple open PRs from different projects", () => {
    const p1 = createProject({ name: "P1" });
    const p2 = createProject({ name: "P2" });
    const repo1 = createRepo(p1.id, {
      repo_url: "https://github.com/acme/x",
    });
    const repo2 = createRepo(p2.id, {
      repo_url: "https://github.com/acme/y",
    });
    const issue1 = createIssue(p1.id, { title: "T1", description: "D1" });
    const issue2 = createIssue(p2.id, { title: "T2", description: "D2" });

    createIssuePR({
      issue_id: issue1.id,
      repo_id: repo1.id,
      pr_number: 1,
      pr_url: "https://github.com/acme/x/pull/1",
    });
    createIssuePR({
      issue_id: issue2.id,
      repo_id: repo2.id,
      pr_number: 2,
      pr_url: "https://github.com/acme/y/pull/2",
    });

    const result = listOpenPRsWithContext();
    expect(result).toHaveLength(2);
    const prNumbers = result.map((r) => r.pr_number).sort();
    expect(prNumbers).toEqual([1, 2]);
  });
});
