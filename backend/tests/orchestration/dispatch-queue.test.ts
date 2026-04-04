/**
 * Tests for the DB-backed dispatch queue
 */
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import {
  enqueueRun,
  isAgentActive,
  getQueuePosition,
  getQueueLength,
  recoverQueue,
} from "../../src/orchestration/dispatch-queue.js";
import * as agentRunRepo from "../../src/db/repositories/agent-runs.js";

const PROJECT_ID = "test-proj";
const ISSUE_ID = "test-issue";
const ISSUE_ID_2 = "test-issue-2";

describe("dispatch-queue", () => {
  beforeEach(() => {
    // Clean up any existing test data
    db.prepare("DELETE FROM AgentRun WHERE project_id = ?").run(PROJECT_ID);
    db.prepare("DELETE FROM Issue WHERE id = ?").run(ISSUE_ID);
    db.prepare("DELETE FROM Issue WHERE id = ?").run(ISSUE_ID_2);
    db.prepare("DELETE FROM Project WHERE id = ?").run(PROJECT_ID);

    // Create test project
    db.prepare(
      "INSERT INTO Project (id, name) VALUES (?, ?)",
    ).run(PROJECT_ID, "Test Project");

    // Create test issues
    db.prepare(
      "INSERT INTO Issue (id, project_id, title, description, status, created_by, chain_depth) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(ISSUE_ID, PROJECT_ID, "Test Issue", "desc", "open", "user", 0);
    db.prepare(
      "INSERT INTO Issue (id, project_id, title, description, status, created_by, chain_depth) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(ISSUE_ID_2, PROJECT_ID, "Test Issue 2", "desc", "open", "user", 0);
  });

  describe("enqueueRun", () => {
    it("creates a queued AgentRun", () => {
      const runId = enqueueRun(PROJECT_ID, ISSUE_ID, "engineer");

      const run = agentRunRepo.getAgentRun(runId);
      expect(run).toBeDefined();
      expect(run?.status).toBe("queued");
      expect(run?.project_id).toBe(PROJECT_ID);
      expect(run?.issue_id).toBe(ISSUE_ID);
      expect(run?.agent_id).toBe("engineer");
    });

    it("returns different run IDs for multiple enqueues", () => {
      const runId1 = enqueueRun(PROJECT_ID, ISSUE_ID, "engineer");
      const runId2 = enqueueRun(PROJECT_ID, ISSUE_ID, "lead");

      expect(runId1).not.toBe(runId2);
    });
  });

  describe("isAgentActive", () => {
    it("returns false when no runs exist", () => {
      expect(isAgentActive(PROJECT_ID, ISSUE_ID, "engineer")).toBe(false);
    });

    it("returns true when agent is queued", () => {
      enqueueRun(PROJECT_ID, ISSUE_ID, "engineer");
      expect(isAgentActive(PROJECT_ID, ISSUE_ID, "engineer")).toBe(true);
    });

    it("returns true when agent is running", () => {
      const run = agentRunRepo.createAgentRun({
        project_id: PROJECT_ID,
        issue_id: ISSUE_ID,
        agent_id: "engineer",
        status: "running",
      });
      agentRunRepo.updateAgentRun(run.id, {
        status: "running",
        started_at: new Date().toISOString(),
      });

      expect(isAgentActive(PROJECT_ID, ISSUE_ID, "engineer")).toBe(true);
    });

    it("returns false when agent is completed", () => {
      const run = agentRunRepo.createAgentRun({
        project_id: PROJECT_ID,
        issue_id: ISSUE_ID,
        agent_id: "engineer",
        status: "running",
      });
      agentRunRepo.updateAgentRun(run.id, {
        status: "completed",
        completed_at: new Date().toISOString(),
      });

      expect(isAgentActive(PROJECT_ID, ISSUE_ID, "engineer")).toBe(false);
    });

    it("distinguishes between different agents on same issue", () => {
      enqueueRun(PROJECT_ID, ISSUE_ID, "engineer");

      expect(isAgentActive(PROJECT_ID, ISSUE_ID, "engineer")).toBe(true);
      expect(isAgentActive(PROJECT_ID, ISSUE_ID, "lead")).toBe(false);
    });

    it("distinguishes between same agent on different issues", () => {
      enqueueRun(PROJECT_ID, ISSUE_ID, "engineer");

      expect(isAgentActive(PROJECT_ID, ISSUE_ID, "engineer")).toBe(true);
      expect(isAgentActive(PROJECT_ID, ISSUE_ID_2, "engineer")).toBe(false);
    });
  });

  describe("getQueuePosition", () => {
    it("returns -1 when agent is not queued", () => {
      expect(getQueuePosition(PROJECT_ID, ISSUE_ID, "engineer")).toBe(-1);
    });

    it("returns 0 for first queued agent", () => {
      enqueueRun(PROJECT_ID, ISSUE_ID, "engineer");
      expect(getQueuePosition(PROJECT_ID, ISSUE_ID, "engineer")).toBe(0);
    });

    it("returns correct position in FIFO order", () => {
      enqueueRun(PROJECT_ID, ISSUE_ID, "engineer");
      enqueueRun(PROJECT_ID, ISSUE_ID_2, "lead");
      enqueueRun(PROJECT_ID, ISSUE_ID, "docs");

      expect(getQueuePosition(PROJECT_ID, ISSUE_ID, "engineer")).toBe(0);
      expect(getQueuePosition(PROJECT_ID, ISSUE_ID_2, "lead")).toBe(1);
      expect(getQueuePosition(PROJECT_ID, ISSUE_ID, "docs")).toBe(2);
    });
  });

  describe("getQueueLength", () => {
    it("returns 0 when no runs are queued", () => {
      expect(getQueueLength(PROJECT_ID)).toBe(0);
    });

    it("returns correct count of queued runs", () => {
      enqueueRun(PROJECT_ID, ISSUE_ID, "engineer");
      expect(getQueueLength(PROJECT_ID)).toBe(1);

      enqueueRun(PROJECT_ID, ISSUE_ID, "lead");
      expect(getQueueLength(PROJECT_ID)).toBe(2);
    });

    it("does not count running or completed runs", () => {
      // Enqueue one
      enqueueRun(PROJECT_ID, ISSUE_ID, "engineer");

      // Create a running one
      const runningRun = agentRunRepo.createAgentRun({
        project_id: PROJECT_ID,
        issue_id: ISSUE_ID,
        agent_id: "lead",
        status: "running",
      });
      agentRunRepo.updateAgentRun(runningRun.id, {
        status: "running",
        started_at: new Date().toISOString(),
      });

      // Create a completed one
      const completedRun = agentRunRepo.createAgentRun({
        project_id: PROJECT_ID,
        issue_id: ISSUE_ID,
        agent_id: "docs",
        status: "completed",
      });
      agentRunRepo.updateAgentRun(completedRun.id, {
        status: "completed",
        completed_at: new Date().toISOString(),
      });

      // Should only count the queued one
      expect(getQueueLength(PROJECT_ID)).toBe(1);
    });
  });

  describe("recoverQueue", () => {
    it("marks running runs as failed", () => {
      const run1 = agentRunRepo.createAgentRun({
        project_id: PROJECT_ID,
        issue_id: ISSUE_ID,
        agent_id: "engineer",
        status: "running",
      });
      agentRunRepo.updateAgentRun(run1.id, {
        status: "running",
        started_at: new Date().toISOString(),
      });

      const run2 = agentRunRepo.createAgentRun({
        project_id: PROJECT_ID,
        issue_id: ISSUE_ID,
        agent_id: "lead",
        status: "running",
      });
      agentRunRepo.updateAgentRun(run2.id, {
        status: "running",
        started_at: new Date().toISOString(),
      });

      const result = recoverQueue();

      expect(result.markedFailed).toBe(2);

      const recovered1 = agentRunRepo.getAgentRun(run1.id);
      const recovered2 = agentRunRepo.getAgentRun(run2.id);

      expect(recovered1?.status).toBe("failed");
      expect(recovered2?.status).toBe("failed");
    });

    it("preserves queued runs", () => {
      const queuedRun = agentRunRepo.createAgentRun({
        project_id: PROJECT_ID,
        issue_id: ISSUE_ID,
        agent_id: "engineer",
        status: "queued",
      });

      const result = recoverQueue();

      expect(result.queued).toBe(1);

      const recovered = agentRunRepo.getAgentRun(queuedRun.id);
      expect(recovered?.status).toBe("queued");
    });

    it("returns correct counts", () => {
      // Create 2 running runs
      const runningRun1 = agentRunRepo.createAgentRun({
        project_id: PROJECT_ID,
        issue_id: ISSUE_ID,
        agent_id: "engineer",
        status: "running",
      });
      agentRunRepo.updateAgentRun(runningRun1.id, {
        status: "running",
        started_at: new Date().toISOString(),
      });

      const runningRun2 = agentRunRepo.createAgentRun({
        project_id: PROJECT_ID,
        issue_id: ISSUE_ID,
        agent_id: "lead",
        status: "running",
      });
      agentRunRepo.updateAgentRun(runningRun2.id, {
        status: "running",
        started_at: new Date().toISOString(),
      });

      // Create 3 queued runs
      enqueueRun(PROJECT_ID, ISSUE_ID, "docs");
      enqueueRun(PROJECT_ID, ISSUE_ID, "librarian");
      enqueueRun(PROJECT_ID, ISSUE_ID, "security");

      const result = recoverQueue();

      expect(result.markedFailed).toBe(2);
      expect(result.queued).toBe(3);
    });
  });
});
