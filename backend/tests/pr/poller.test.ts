import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../../src/db/index.js";
import { createProject } from "../../src/db/repositories/projects.js";
import { createRepo } from "../../src/db/repositories/repos.js";
import { createIssue, getIssue } from "../../src/db/repositories/issues.js";
import { createIssuePR } from "../../src/db/repositories/issue-prs.js";
import { createGitHubAccount } from "../../src/db/repositories/github-accounts.js";
import { pollPRs } from "../../src/pr/poller.js";

function clearAll() {
  db.exec("DELETE FROM ActivityLog");
  db.exec("DELETE FROM IssuePR");
  db.exec("DELETE FROM Comment");
  db.exec("DELETE FROM Issue");
  db.exec("DELETE FROM Repo");
  db.exec("DELETE FROM Project");
  db.exec("DELETE FROM GitHubAccount");
}

beforeEach(() => {
  clearAll();
  vi.restoreAllMocks();
});

/** Helper to create a mock fetch that returns merged PR data. */
function mockMergedPRResponse() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      state: "closed",
      merged: true,
      mergeable: null,
      head: { sha: "abc123" },
    }),
  } as Response);
}

describe("pollPRs", () => {
  describe("merged PR transitions issue to done", () => {
    it("transitions issue from pr_created to done when PR is merged", async () => {
      const fetchSpy = mockMergedPRResponse();

      const account = createGitHubAccount({
        account_name: "testuser",
        github_username: "testuser",
        oauth_token: "gho_test",
      });
      const project = createProject({ name: "P", github_account_id: account.id });
      const repo = createRepo(project.id, { github_url: "https://github.com/acme/repo" });
      const issue = createIssue(project.id, { title: "T", description: "D", status: "pr_created" });
      createIssuePR({
        issue_id: issue.id,
        repo_id: repo.id,
        pr_number: 1,
        pr_url: "https://github.com/acme/repo/pull/1",
      });

      await pollPRs();

      const updated = getIssue(issue.id);
      expect(updated?.status).toBe("done");
      fetchSpy.mockRestore();
    });

    it("transitions issue from in_progress to done when PR is merged", async () => {
      const fetchSpy = mockMergedPRResponse();

      const account = createGitHubAccount({
        account_name: "testuser",
        github_username: "testuser",
        oauth_token: "gho_test",
      });
      const project = createProject({ name: "P", github_account_id: account.id });
      const repo = createRepo(project.id, { github_url: "https://github.com/acme/repo" });
      const issue = createIssue(project.id, { title: "T", description: "D", status: "in_progress" });
      createIssuePR({
        issue_id: issue.id,
        repo_id: repo.id,
        pr_number: 1,
        pr_url: "https://github.com/acme/repo/pull/1",
      });

      await pollPRs();

      const updated = getIssue(issue.id);
      expect(updated?.status).toBe("done");
      fetchSpy.mockRestore();
    });

    it("does not transition issue that is already done", async () => {
      const fetchSpy = mockMergedPRResponse();

      const account = createGitHubAccount({
        account_name: "testuser",
        github_username: "testuser",
        oauth_token: "gho_test",
      });
      const project = createProject({ name: "P", github_account_id: account.id });
      const repo = createRepo(project.id, { github_url: "https://github.com/acme/repo" });
      const issue = createIssue(project.id, { title: "T", description: "D", status: "done" });
      createIssuePR({
        issue_id: issue.id,
        repo_id: repo.id,
        pr_number: 1,
        pr_url: "https://github.com/acme/repo/pull/1",
      });

      await pollPRs();

      const updated = getIssue(issue.id);
      expect(updated?.status).toBe("done");
      fetchSpy.mockRestore();
    });
  });
});
