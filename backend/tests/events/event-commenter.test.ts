import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { eventBus } from "../../src/events/bus.js";
import { initEventCommenter } from "../../src/events/event-commenter.js";
import { listComments } from "../../src/db/repositories/comments.js";
import { createIssue } from "../../src/db/repositories/issues.js";
import { createProject, updateProject } from "../../src/db/repositories/projects.js";
import { createRepo } from "../../src/db/repositories/repos.js";
import { createIssuePR } from "../../src/db/repositories/issue-prs.js";
import { db } from "../../src/db/index.js";
import * as dispatchQueue from "../../src/orchestration/dispatch-queue.js";

describe("Event Commenter", () => {
  let projectId: string;
  let issueId: string;
  let repoId: string;

  beforeAll(() => {
    // Initialize event commenter once for all tests
    initEventCommenter();
  });

  beforeEach(() => {
    // Clear database between tests (in correct order due to foreign keys)
    db.prepare("DELETE FROM Comment").run();
    db.prepare("DELETE FROM IssuePR").run();
    db.prepare("DELETE FROM AgentRun").run();
    db.prepare("DELETE FROM Issue").run();
    db.prepare("DELETE FROM Repo").run();
    db.prepare("DELETE FROM Project").run();

    // Create test project
    const project = createProject({
      name: "Test Project",
      max_concurrency: 1,
    });
    projectId = project.id;

    // Create test repo
    const repo = createRepo(projectId, {
      repo_url: "https://github.com/test/repo",
      default_branch: "main",
    });
    repoId = repo.id;

    // Create test issue
    const issue = createIssue(projectId, {
      title: "Test Issue",
      description: "Test description",
      status: "open",
    });
    issueId = issue.id;
  });

  describe("run.completed event", () => {
    it("posts comment on successful completion", () => {
      eventBus.emit("run.completed", {
        agent_run_id: "run-1",
        project_id: projectId,
        issue_id: issueId,
        agent_id: "engineer",
        status: "completed",
        exit_code: 0,
        cost_usd: 0.12,
        duration_ms: 45000,
        completed_at: new Date().toISOString(),
      });

      const comments = listComments(issueId);
      expect(comments).toHaveLength(1);
      expect(comments[0].author_type).toBe("system");
      expect(comments[0].content).toContain("✅");
      expect(comments[0].content).toContain("engineer");
      expect(comments[0].content).toContain("completed");
      expect(comments[0].content).toContain("exit code 0");
      expect(comments[0].content).toContain("$0.12");
      expect(comments[0].content).toContain("45.0s");
    });

    it("posts comment on failure", () => {
      eventBus.emit("run.completed", {
        agent_run_id: "run-1",
        project_id: projectId,
        issue_id: issueId,
        agent_id: "engineer",
        status: "failed",
        exit_code: 1,
        cost_usd: 0.05,
        duration_ms: 10000,
        completed_at: new Date().toISOString(),
      });

      const comments = listComments(issueId);
      expect(comments).toHaveLength(1);
      expect(comments[0].content).toContain("❌");
      expect(comments[0].content).toContain("engineer");
      expect(comments[0].content).toContain("failed");
      expect(comments[0].content).toContain("exit code 1");
    });

    it("posts comment on timeout", () => {
      eventBus.emit("run.completed", {
        agent_run_id: "run-1",
        project_id: projectId,
        issue_id: issueId,
        agent_id: "engineer",
        status: "timeout",
        exit_code: null,
        cost_usd: null,
        duration_ms: 600000,
        completed_at: new Date().toISOString(),
      });

      const comments = listComments(issueId);
      expect(comments).toHaveLength(1);
      expect(comments[0].content).toContain("⏱️");
      expect(comments[0].content).toContain("engineer");
      expect(comments[0].content).toContain("timed out");
    });

    it("does not post comment if no issue_id", () => {
      eventBus.emit("run.completed", {
        agent_run_id: "run-1",
        project_id: projectId,
        issue_id: null,
        agent_id: "librarian",
        status: "completed",
        exit_code: 0,
        cost_usd: 0.01,
        duration_ms: 5000,
        completed_at: new Date().toISOString(),
      });

      const comments = listComments(issueId);
      expect(comments).toHaveLength(0);
    });

    it("auto-starts captain if project has auto_start enabled", () => {
      const enqueueRunSpy = vi.spyOn(dispatchQueue, "enqueueRun");
      const isAgentActiveSpy = vi
        .spyOn(dispatchQueue, "isAgentActive")
        .mockReturnValue(false);

      // Update project to enable auto_start
      updateProject(projectId, { auto_start: true });

      eventBus.emit("run.completed", {
        agent_run_id: "run-1",
        project_id: projectId,
        issue_id: issueId,
        agent_id: "engineer",
        status: "completed",
        exit_code: 0,
        cost_usd: 0.12,
        duration_ms: 45000,
        completed_at: new Date().toISOString(),
      });

      expect(isAgentActiveSpy).toHaveBeenCalledWith(
        projectId,
        issueId,
        "captain",
      );
      expect(enqueueRunSpy).toHaveBeenCalledWith(projectId, issueId, "captain");
    });

    it("does not auto-start captain if already active", () => {
      const enqueueRunSpy = vi.spyOn(dispatchQueue, "enqueueRun");
      const isAgentActiveSpy = vi
        .spyOn(dispatchQueue, "isAgentActive")
        .mockReturnValue(true);

      // Update project to enable auto_start
      updateProject(projectId, { auto_start: true });

      eventBus.emit("run.completed", {
        agent_run_id: "run-1",
        project_id: projectId,
        issue_id: issueId,
        agent_id: "engineer",
        status: "completed",
        exit_code: 0,
        cost_usd: 0.12,
        duration_ms: 45000,
        completed_at: new Date().toISOString(),
      });

      expect(isAgentActiveSpy).toHaveBeenCalledWith(
        projectId,
        issueId,
        "captain",
      );
      expect(enqueueRunSpy).not.toHaveBeenCalled();
    });
  });

  describe("pr.status_changed event", () => {
    it("posts comment when PR is merged", () => {
      const issuePR = createIssuePR({
        issue_id: issueId,
        repo_id: repoId,
        pr_number: 42,
        pr_url: "https://github.com/test/repo/pull/42",
        status: "open",
      });

      eventBus.emit("pr.status_changed", {
        pr_id: issuePR.id,
        project_id: projectId,
        from: "open",
        to: "merged",
      });

      const comments = listComments(issueId);
      expect(comments).toHaveLength(1);
      expect(comments[0].author_type).toBe("system");
      expect(comments[0].content).toContain("🎉");
      expect(comments[0].content).toContain("PR #42");
      expect(comments[0].content).toContain("merged");
    });

    it("posts comment when PR is closed", () => {
      const issuePR = createIssuePR({
        issue_id: issueId,
        repo_id: repoId,
        pr_number: 43,
        pr_url: "https://github.com/test/repo/pull/43",
        status: "open",
      });

      eventBus.emit("pr.status_changed", {
        pr_id: issuePR.id,
        project_id: projectId,
        from: "open",
        to: "closed",
      });

      const comments = listComments(issueId);
      expect(comments).toHaveLength(1);
      expect(comments[0].content).toContain("🚫");
      expect(comments[0].content).toContain("PR #43");
      expect(comments[0].content).toContain("closed");
      expect(comments[0].content).toContain("not merged");
    });

    it("handles PR not found gracefully", () => {
      eventBus.emit("pr.status_changed", {
        pr_id: "nonexistent-pr",
        project_id: projectId,
        from: "open",
        to: "merged",
      });

      const comments = listComments(issueId);
      expect(comments).toHaveLength(0);
    });
  });

  describe("issue.status_changed event", () => {
    it("posts comment on status change", () => {
      eventBus.emit("issue.status_changed", {
        issue_id: issueId,
        project_id: projectId,
        from: "open",
        to: "in_progress",
      });

      const comments = listComments(issueId);
      expect(comments).toHaveLength(1);
      expect(comments[0].author_type).toBe("system");
      expect(comments[0].content).toContain("📊");
      expect(comments[0].content).toContain("Open");
      expect(comments[0].content).toContain("In Progress");
    });

    it("posts comment for PR conflicts", () => {
      eventBus.emit("issue.status_changed", {
        issue_id: issueId,
        project_id: projectId,
        from: "pr_created",
        to: "pr_conflict",
      });

      const comments = listComments(issueId);
      expect(comments).toHaveLength(1);
      expect(comments[0].content).toContain("⚠️");
      expect(comments[0].content).toContain("merge conflicts");
    });

    it("posts comment for PR checks failed", () => {
      eventBus.emit("issue.status_changed", {
        issue_id: issueId,
        project_id: projectId,
        from: "pr_created",
        to: "pr_failed_actions",
      });

      const comments = listComments(issueId);
      expect(comments).toHaveLength(1);
      expect(comments[0].content).toContain("❌");
      expect(comments[0].content).toContain("checks failed");
    });

    it("posts comment for ready to merge", () => {
      eventBus.emit("issue.status_changed", {
        issue_id: issueId,
        project_id: projectId,
        from: "pr_created",
        to: "pr_ready_to_merge",
      });

      const comments = listComments(issueId);
      expect(comments).toHaveLength(1);
      expect(comments[0].content).toContain("✅");
      expect(comments[0].content).toContain("ready to merge");
    });
  });
});
