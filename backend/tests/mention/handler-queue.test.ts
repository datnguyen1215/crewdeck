/**
 * Integration tests for the dispatch queue behavior in mention/handler.ts.
 * Tests queue-on-limit, drain-on-complete, and skip-if-running behaviors.
 */
import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from "vitest";
import { db } from "../../src/db/index.js";
import { eventBus } from "../../src/events/bus.js";
import * as dispatchQueue from "../../src/dispatch/queue.js";
import type { EventMap } from "../../src/events/types.js";

// Track mock processes globally so they persist across mock resets
const mockExitResolvers = new Map<number, (value: { code: number; stdout: string }) => void>();
let nextPid = 1000;

vi.mock("../../src/agent/adapters/process.js", () => ({
  spawnClaude: vi.fn(async () => {
    const pid = nextPid++;
    let resolve: (value: { code: number; stdout: string }) => void;
    const exitPromise = new Promise<{ code: number; stdout: string }>((r) => {
      resolve = r;
      mockExitResolvers.set(pid, r);
    });
    return {
      pid,
      process: { kill: vi.fn(), killed: false },
      exitPromise,
    };
  }),
}));

vi.mock("../../src/agent/worktree.js", () => ({
  createWorktree: vi.fn(async () => ({ path: "/tmp/test-worktree" })),
}));

// Import handler after mocks are set up
import * as handler from "../../src/mention/handler.js";
import { spawnClaude } from "../../src/agent/adapters/process.js";

// Initialize once
handler.initMentionHandler();

// Use unique IDs per test to avoid state bleeding
let testCounter = 0;

describe("handler queue integration", () => {
  let projectId: string;
  let issueId: string;
  let issueId2: string;
  let spawnedEvents: EventMap["mention.spawned"][];
  let queuedEvents: EventMap["dispatch.queued"][];
  let dequeuedEvents: EventMap["dispatch.dequeued"][];
  let completedEvents: EventMap["mention.completed"][];
  let spawnedHandler: (e: EventMap["mention.spawned"]) => void;
  let queuedHandler: (e: EventMap["dispatch.queued"]) => void;
  let dequeuedHandler: (e: EventMap["dispatch.dequeued"]) => void;
  let completedHandler: (e: EventMap["mention.completed"]) => void;

  afterAll(() => {
    handler.shutdownMentionHandler();
  });

  beforeEach(() => {
    // Use unique IDs per test
    testCounter++;
    projectId = `test-project-${testCounter}`;
    issueId = `test-issue-${testCounter}`;
    issueId2 = `test-issue-${testCounter}-2`;

    // Clear queue state
    dispatchQueue.clearAllQueues();

    // Reset PID counter and mock call counts
    nextPid = 1000;
    vi.mocked(spawnClaude).mockClear();

    // Event collectors
    spawnedEvents = [];
    queuedEvents = [];
    dequeuedEvents = [];
    completedEvents = [];

    // Seed test data with unique IDs
    db.prepare("INSERT INTO Project (id, name, max_concurrency) VALUES (?, ?, ?)").run(
      projectId,
      "Test Project Queue",
      2, // Allow 2 concurrent agents
    );
    db.prepare(
      "INSERT INTO Issue (id, project_id, title, description, status, created_by, chain_depth) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(issueId, projectId, "Test Issue", "desc", "open", "user", 0);
    db.prepare(
      "INSERT INTO Issue (id, project_id, title, description, status, created_by, chain_depth) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(issueId2, projectId, "Test Issue 2", "desc", "open", "user", 0);

    // Collect events for this project only
    spawnedHandler = (e) => {
      if (e.project_id === projectId) spawnedEvents.push(e);
    };
    queuedHandler = (e) => {
      if (e.project_id === projectId) queuedEvents.push(e);
    };
    dequeuedHandler = (e) => {
      if (e.project_id === projectId) dequeuedEvents.push(e);
    };
    completedHandler = (e) => {
      if (e.project_id === projectId) completedEvents.push(e);
    };

    eventBus.on("mention.spawned", spawnedHandler);
    eventBus.on("dispatch.queued", queuedHandler);
    eventBus.on("dispatch.dequeued", dequeuedHandler);
    eventBus.on("mention.completed", completedHandler);
  });

  afterEach(async () => {
    // Remove event listeners first
    eventBus.off("mention.spawned", spawnedHandler);
    eventBus.off("dispatch.queued", queuedHandler);
    eventBus.off("dispatch.dequeued", dequeuedHandler);
    eventBus.off("mention.completed", completedHandler);

    // Clear queues BEFORE completing processes to prevent drain-on-complete
    // from trying to spawn agents after test data is deleted
    dispatchQueue.clearAllQueues();

    // Complete ALL pending processes to clean up handler state
    const resolvers = [...mockExitResolvers.entries()];
    for (const [pid, resolve] of resolvers) {
      resolve({ code: 0, stdout: "{}" });
      mockExitResolvers.delete(pid);
    }

    // Wait for all async handlers to settle
    await new Promise((r) => setTimeout(r, 200));

    // Cleanup test data - use LIKE to catch both issue IDs
    db.prepare("DELETE FROM Comment WHERE issue_id LIKE ?").run(`test-issue-${testCounter}%`);
    db.prepare("DELETE FROM Issue WHERE id LIKE ?").run(`test-issue-${testCounter}%`);
    db.prepare("DELETE FROM Project WHERE id = ?").run(projectId);
  });

  // Helper to complete a process by PID
  const completeProcess = (pid: number, code = 0, stdout = "{}") => {
    const resolve = mockExitResolvers.get(pid);
    if (resolve) {
      resolve({ code, stdout });
      mockExitResolvers.delete(pid);
    }
  };

  // Helper to dispatch agent via comment
  const dispatchAgent = async (agentId: string, targetIssueId?: string) => {
    const targetId = targetIssueId || issueId;
    const comment = {
      id: `c-${Date.now()}-${Math.random()}`,
      issue_id: targetId,
      content: `/dispatch ${agentId}`,
      author_type: "user" as const,
      author_id: null,
      created_at: new Date().toISOString(),
    };
    eventBus.emit("comment.added", { comment, project_id: projectId });
    await new Promise((r) => setTimeout(r, 50));
  };

  describe("queue-on-limit behavior", () => {
    it("queues agent when concurrency limit is reached", async () => {
      // Spawn 2 agents to hit the concurrency limit (max_concurrency = 2)
      await dispatchAgent("engineer");
      await dispatchAgent("security");

      // Both should spawn - check via events
      expect(spawnedEvents.length).toBe(2);
      expect(handler.getActiveProcessCount(projectId)).toBe(2);

      // Now try to spawn a third agent - should be queued
      await dispatchAgent("architect");

      // Third should NOT spawn (still 2 spawned events)
      expect(spawnedEvents.length).toBe(2);

      // Check that dispatch.queued event was emitted
      expect(queuedEvents.length).toBe(1);
      expect(queuedEvents[0]).toMatchObject({
        project_id: projectId,
        issue_id: issueId,
        agent_id: "architect",
        position: 0,
      });

      // Check the queue state
      expect(dispatchQueue.getQueueLength(projectId)).toBe(1);
      expect(dispatchQueue.isQueued(projectId, issueId, "architect")).toBe(true);
    });

    it("rolls back chain_depth when queueing", async () => {
      // Get initial chain_depth
      const initialIssue = db
        .prepare("SELECT chain_depth FROM Issue WHERE id = ?")
        .get(issueId) as { chain_depth: number };
      const initialDepth = initialIssue.chain_depth;

      // Fill concurrency limit
      await dispatchAgent("engineer");
      await dispatchAgent("security");

      // Chain depth should have increased by 2 for the two spawns
      const afterSpawnsIssue = db
        .prepare("SELECT chain_depth FROM Issue WHERE id = ?")
        .get(issueId) as { chain_depth: number };
      expect(afterSpawnsIssue.chain_depth).toBe(initialDepth + 2);

      // Try to queue a third agent
      await dispatchAgent("architect");

      // Chain depth should NOT have increased (rollback happened)
      const afterQueueIssue = db
        .prepare("SELECT chain_depth FROM Issue WHERE id = ?")
        .get(issueId) as { chain_depth: number };
      expect(afterQueueIssue.chain_depth).toBe(initialDepth + 2);

      // Verify agent was queued
      expect(dispatchQueue.getQueueLength(projectId)).toBe(1);
    });

    it("creates system comment when queueing with correct position message", async () => {
      // Fill concurrency limit
      await dispatchAgent("engineer");
      await dispatchAgent("security");

      // Queue first agent - should say "next in line"
      await dispatchAgent("architect");

      // Queue second agent - should say "1 agent ahead"
      await dispatchAgent("quality");

      // Check system comments were created
      const comments = db
        .prepare("SELECT content FROM Comment WHERE issue_id = ? AND author_type = 'system' ORDER BY created_at")
        .all(issueId) as { content: string }[];

      const queuedComments = comments.filter((c) => c.content.includes("queued"));
      expect(queuedComments.length).toBeGreaterThanOrEqual(2);
      expect(queuedComments.some((c) => c.content.includes("next in line"))).toBe(true);
      expect(queuedComments.some((c) => c.content.includes("1 agent ahead"))).toBe(true);
    });
  });

  describe("drain-on-complete behavior", () => {
    it("spawns next queued agent when concurrency frees up", async () => {
      // Fill concurrency limit
      await dispatchAgent("engineer");
      await dispatchAgent("security");

      expect(spawnedEvents.length).toBe(2);
      expect(handler.getActiveProcessCount(projectId)).toBe(2);

      // Queue an agent
      await dispatchAgent("architect");

      expect(spawnedEvents.length).toBe(2);
      expect(dispatchQueue.getQueueLength(projectId)).toBe(1);

      // Complete one of the running agents (PID 1000 = first spawned)
      completeProcess(1000, 0, JSON.stringify({ result: "done" }));
      await new Promise((r) => setTimeout(r, 100));

      // Should have spawned the queued agent (3 total spawned events)
      expect(spawnedEvents.length).toBe(3);
      expect(dispatchQueue.getQueueLength(projectId)).toBe(0);

      // Check dispatch.dequeued event was emitted
      expect(dequeuedEvents.length).toBe(1);
      expect(dequeuedEvents[0]).toMatchObject({
        project_id: projectId,
        issue_id: issueId,
        agent_id: "architect",
      });
    });

    it("creates dequeued system comment when spawning from queue", async () => {
      // Fill concurrency limit
      await dispatchAgent("engineer");
      await dispatchAgent("security");

      // Queue an agent
      await dispatchAgent("architect");

      // Complete one agent to trigger drain
      completeProcess(1000, 0, "{}");
      await new Promise((r) => setTimeout(r, 100));

      // Check for dequeued comment
      const comments = db
        .prepare("SELECT content FROM Comment WHERE issue_id = ? AND author_type = 'system' ORDER BY created_at")
        .all(issueId) as { content: string }[];

      expect(comments.some((c) => c.content.includes("dequeued, spawning now"))).toBe(true);
    });

    it("respects FIFO order when draining queue", async () => {
      // Fill concurrency limit
      await dispatchAgent("engineer");
      await dispatchAgent("security");

      // Queue multiple agents
      await dispatchAgent("architect");
      await dispatchAgent("quality");

      expect(dispatchQueue.getQueueLength(projectId)).toBe(2);

      // Complete first running agent
      completeProcess(1000, 0, "{}");
      await new Promise((r) => setTimeout(r, 100));

      // Architect should be dequeued first (FIFO)
      expect(dequeuedEvents.length).toBe(1);
      expect(dequeuedEvents[0].agent_id).toBe("architect");
      expect(dispatchQueue.getQueueLength(projectId)).toBe(1);

      // Complete another agent
      completeProcess(1001, 0, "{}");
      await new Promise((r) => setTimeout(r, 100));

      // Quality should be dequeued next
      expect(dequeuedEvents.length).toBe(2);
      expect(dequeuedEvents[1].agent_id).toBe("quality");
      expect(dispatchQueue.getQueueLength(projectId)).toBe(0);
    });
  });

  describe("skip-if-running behavior", () => {
    it("skips queued agent if already running for the same issue", async () => {
      // Spawn engineer on issue 1
      await dispatchAgent("engineer");

      // Spawn security on issue 1 to fill limit
      await dispatchAgent("security");

      expect(spawnedEvents.length).toBe(2);

      // Manually enqueue engineer again for the same issue (will be skipped when drained)
      dispatchQueue.enqueue({
        projectId: projectId,
        issueId: issueId,
        agentId: "engineer", // Same as already running
        queuedAt: new Date(),
      });

      // Queue architect for the same issue (will be spawned)
      dispatchQueue.enqueue({
        projectId: projectId,
        issueId: issueId,
        agentId: "architect",
        queuedAt: new Date(),
      });

      expect(dispatchQueue.getQueueLength(projectId)).toBe(2);

      // Complete security (not engineer) to trigger drain
      completeProcess(1001, 0, "{}");
      await new Promise((r) => setTimeout(r, 100));

      // Engineer should be skipped (still running), architect should spawn
      expect(dequeuedEvents.length).toBe(1);
      expect(dequeuedEvents[0].agent_id).toBe("architect");

      // Queue should be empty - engineer was dequeued (and skipped), architect was dequeued and spawned
      expect(dispatchQueue.getQueueLength(projectId)).toBe(0);
    });

    it("allows same agent on different issues", async () => {
      // Spawn engineer on issue 1
      await dispatchAgent("engineer");

      // Spawn security on issue 1 to fill limit
      await dispatchAgent("security");

      expect(spawnedEvents.length).toBe(2);

      // Queue engineer on issue 2 (different issue, should be allowed)
      dispatchQueue.enqueue({
        projectId: projectId,
        issueId: issueId2, // Different issue
        agentId: "engineer",
        queuedAt: new Date(),
      });

      expect(dispatchQueue.getQueueLength(projectId)).toBe(1);

      // Complete one agent to trigger drain
      completeProcess(1000, 0, "{}");
      await new Promise((r) => setTimeout(r, 100));

      // Engineer on issue 2 should spawn (different issue)
      expect(dequeuedEvents.length).toBe(1);
      expect(dequeuedEvents[0]).toMatchObject({
        agent_id: "engineer",
        issue_id: issueId2,
      });
      expect(dispatchQueue.getQueueLength(projectId)).toBe(0);
    });
  });

  describe("mention.completed triggers queue drain", () => {
    it("drains queue when agent completes", async () => {
      // Fill concurrency limit
      await dispatchAgent("engineer");
      await dispatchAgent("security");

      expect(spawnedEvents.length).toBe(2);

      // Queue an agent
      await dispatchAgent("architect");

      expect(spawnedEvents.length).toBe(2);
      expect(dispatchQueue.getQueueLength(projectId)).toBe(1);

      // Simulate agent completion by completing the mock process
      // This will emit mention.completed which should trigger drainQueue
      completeProcess(1000, 0, JSON.stringify({ result: "done" }));
      await new Promise((r) => setTimeout(r, 100));

      // Queue should be drained
      expect(dispatchQueue.getQueueLength(projectId)).toBe(0);
      expect(spawnedEvents.length).toBe(3); // 2 initial + 1 dequeued
    });
  });
});
