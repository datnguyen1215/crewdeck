import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import { EventBus } from "../../src/events/bus.js";
import { db } from "../../src/db/index.js";
import { OrchestratorManager } from "../../src/orchestrator/index.js";
import type { AgentAdapter, SessionHandle } from "../../src/agent/types.js";

// --- DB helpers ---

let projectId: string;
let crewId: string;
let captainId: string;
let agentId: string;
let reviewerAgentId: string;
let issueId: string;

function seedProject(): void {
  projectId = crypto.randomUUID();
  crewId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO Project (id, name, max_concurrency, max_review_rounds) VALUES (?, ?, ?, ?)",
  ).run(projectId, "Test Project", 2, 3);
  db.prepare("INSERT INTO Crew (id, project_id, name) VALUES (?, ?, ?)").run(
    crewId,
    projectId,
    "Test Crew",
  );
}

function seedAgents(): void {
  captainId = crypto.randomUUID();
  agentId = crypto.randomUUID();
  reviewerAgentId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO Agent (id, crew_id, name, title, description, system_prompt, is_captain) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(captainId, crewId, "Captain", "project coordinator", null, "You are the captain.", 1);
  db.prepare(
    "INSERT INTO Agent (id, crew_id, name, title, description, system_prompt) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(agentId, crewId, "Alice", "developer", null, "You are Alice");
  db.prepare(
    "INSERT INTO Agent (id, crew_id, name, title, description, system_prompt) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(reviewerAgentId, crewId, "Bob", "reviewer", null, "You are Bob");
}

function seedIssue(status = "open"): void {
  issueId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO Issue (id, project_id, title, description, status, created_by) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(issueId, projectId, "Fix auth bug", "OAuth is broken", status, "user");
}

function makeAdapter(): AgentAdapter {
  return {
    spawn: vi.fn().mockResolvedValue({ sessionName: "test-session" } as SessionHandle),
    send: vi.fn().mockResolvedValue(undefined),
    getOutput: vi.fn().mockResolvedValue(""),
    isAlive: vi.fn().mockResolvedValue(false),
    kill: vi.fn().mockResolvedValue(undefined),
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

describe("OrchestratorManager", () => {
  let bus: EventBus;
  let adapter: AgentAdapter;
  let manager: OrchestratorManager;

  beforeAll(() => {
    seedProject();
    seedAgents();
  });

  beforeEach(() => {
    db.prepare(
      "DELETE FROM Comment WHERE issue_id IN (SELECT id FROM Issue WHERE project_id = ?)",
    ).run(projectId);
    db.prepare(
      "DELETE FROM IssueAgent WHERE issue_id IN (SELECT id FROM Issue WHERE project_id = ?)",
    ).run(projectId);
    db.prepare("DELETE FROM Session WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM Issue WHERE project_id = ?").run(projectId);
    db.prepare(
      "UPDATE Project SET orchestrator_session_id = NULL WHERE id = ?",
    ).run(projectId);

    bus = new EventBus();
    adapter = makeAdapter();
    manager = new OrchestratorManager(bus, adapter);
    manager.init();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Captain session management ---

  describe("captain session", () => {
    it("spawns a persistent captain session on first event", async () => {
      seedIssue();
      const issue = db.prepare("SELECT * FROM Issue WHERE id = ?").get(issueId) as Record<string, unknown>;
      bus.emit("issue.created", { issue: issue as never });
      await flushPromises();

      // Should spawn captain session (interactive, not --print)
      expect(adapter.spawn).toHaveBeenCalled();
      const call = vi.mocked(adapter.spawn).mock.calls[0][0];
      expect(call.print).toBeUndefined();
      expect(call.sessionName).toContain("captain");
      expect(call.systemPrompt).toBe("You are the captain.");
      expect(call.env?.CREWDECK_PROJECT_ID).toBe(projectId);
    });

    it("reuses existing captain session for subsequent events", async () => {
      // Make isAlive return true so the session appears alive
      vi.mocked(adapter.isAlive).mockResolvedValue(true);

      seedIssue();
      const issue = db.prepare("SELECT * FROM Issue WHERE id = ?").get(issueId) as Record<string, unknown>;

      // First event spawns captain
      bus.emit("issue.created", { issue: issue as never });
      await flushPromises();
      expect(adapter.spawn).toHaveBeenCalledTimes(1);

      // Second event reuses existing session
      bus.emit("issue.created", { issue: issue as never });
      await flushPromises();
      expect(adapter.spawn).toHaveBeenCalledTimes(1); // still 1
      expect(adapter.send).toHaveBeenCalled(); // sends message instead
    });

    it("respawns captain if session died", async () => {
      // First call: alive=false (not yet spawned), then alive=true after spawn, then alive=false (died)
      let callCount = 0;
      vi.mocked(adapter.isAlive).mockImplementation(async () => {
        callCount++;
        // First event: session doesn't exist yet → returns false → spawn
        // After spawn, second event checks: session died → returns false → respawn
        return false;
      });

      seedIssue();
      const issue = db.prepare("SELECT * FROM Issue WHERE id = ?").get(issueId) as Record<string, unknown>;

      bus.emit("issue.created", { issue: issue as never });
      await flushPromises();
      expect(adapter.spawn).toHaveBeenCalledTimes(1);

      // Session "dies" — next event should respawn
      bus.emit("issue.created", { issue: issue as never });
      await flushPromises();
      expect(adapter.spawn).toHaveBeenCalledTimes(2);
    });
  });

  // --- Event relay via send-keys ---

  describe("event relay", () => {
    it("sends issue.created event to captain via send-keys", async () => {
      vi.mocked(adapter.isAlive).mockResolvedValue(true);

      seedIssue();
      const issue = db.prepare("SELECT * FROM Issue WHERE id = ?").get(issueId) as Record<string, unknown>;
      bus.emit("issue.created", { issue: issue as never });
      await flushPromises();

      // First spawn, then send on subsequent events — but first event both spawns and sends
      // The send happens after spawn
      expect(adapter.send).toHaveBeenCalled();
      const sendCall = vi.mocked(adapter.send).mock.calls[0];
      expect(sendCall[1]).toContain("Fix auth bug");
    });

    it("sends agent.finished event to captain", async () => {
      vi.mocked(adapter.isAlive).mockResolvedValue(true);
      // Pre-spawn captain
      await manager.ensureCaptainSession(projectId);

      seedIssue("in_progress");
      bus.emit("agent.finished", {
        session_id: "s1",
        agent_id: agentId,
        issue_id: issueId,
        project_id: projectId,
        role: "worker",
      });
      await flushPromises();

      const sendCalls = vi.mocked(adapter.send).mock.calls;
      const relevantCall = sendCalls.find((c) => c[1].includes("finished"));
      expect(relevantCall).toBeDefined();
      expect(relevantCall![1]).toContain("Alice");
    });

    it("does not relay orchestrator/agent comments", async () => {
      vi.mocked(adapter.isAlive).mockResolvedValue(true);

      bus.emit("comment.added", {
        comment: {
          id: "c1",
          issue_id: "i1",
          author_type: "orchestrator",
          author_id: null,
          content: "X",
          created_at: "",
        },
        project_id: projectId,
      });
      await flushPromises();

      // No captain session spawned, no send
      expect(adapter.spawn).not.toHaveBeenCalled();
      expect(adapter.send).not.toHaveBeenCalled();
    });

    it("relays user comments to captain", async () => {
      vi.mocked(adapter.isAlive).mockResolvedValue(true);
      await manager.ensureCaptainSession(projectId);

      bus.emit("comment.added", {
        comment: {
          id: "c2",
          issue_id: "i1",
          author_type: "user",
          author_id: null,
          content: "Please reprioritize",
          created_at: "",
        },
        project_id: projectId,
      });
      await flushPromises();

      const sendCalls = vi.mocked(adapter.send).mock.calls;
      const relevantCall = sendCalls.find((c) => c[1].includes("reprioritize"));
      expect(relevantCall).toBeDefined();
    });

    it("does not relay orchestrator-created issues", async () => {
      seedIssue();
      db.prepare("UPDATE Issue SET created_by = 'orchestrator' WHERE id = ?").run(issueId);
      const issue = db.prepare("SELECT * FROM Issue WHERE id = ?").get(issueId) as Record<string, unknown>;
      bus.emit("issue.created", { issue: issue as never });
      await flushPromises();
      expect(adapter.spawn).not.toHaveBeenCalled();
    });
  });

  // --- Captain CLI action: assign ---

  describe("captain.assign action", () => {
    it("assigns agent to issue via captain.assign event", async () => {
      seedIssue("open");
      bus.emit("captain.assign", {
        project_id: projectId,
        issue_id: issueId,
        agent_id: agentId,
      });
      await flushPromises();

      const updated = db
        .prepare("SELECT status, assigned_agent_id FROM Issue WHERE id = ?")
        .get(issueId) as { status: string; assigned_agent_id: string };
      expect(updated.status).toBe("in_progress");
      expect(updated.assigned_agent_id).toBe(agentId);

      // Should spawn a worker session
      const spawnCalls = vi.mocked(adapter.spawn).mock.calls;
      const workerSpawn = spawnCalls.find((c) => c[0].sessionName.includes("worker"));
      expect(workerSpawn).toBeDefined();
      expect(workerSpawn![0].env?.CREWDECK_AGENT_ID).toBe(agentId);
    });

    it("creates IssueAgent record", async () => {
      seedIssue("open");
      bus.emit("captain.assign", {
        project_id: projectId,
        issue_id: issueId,
        agent_id: agentId,
      });
      await flushPromises();

      const ia = db
        .prepare("SELECT * FROM IssueAgent WHERE issue_id = ? AND role = 'worker'")
        .get(issueId) as { status: string } | undefined;
      expect(ia).toBeDefined();
      expect(ia!.status).toBe("active");
    });

    it("posts a comment after assign", async () => {
      seedIssue("open");
      bus.emit("captain.assign", {
        project_id: projectId,
        issue_id: issueId,
        agent_id: agentId,
      });
      await flushPromises();

      const comments = db
        .prepare("SELECT content FROM Comment WHERE issue_id = ? AND author_type = 'orchestrator'")
        .all(issueId) as Array<{ content: string }>;
      expect(comments.length).toBeGreaterThan(0);
      expect(comments[0].content).toContain("Alice");
    });

    it("enforces concurrency limit", async () => {
      const i1 = crypto.randomUUID();
      const i2 = crypto.randomUUID();
      db.prepare(
        "INSERT INTO Issue (id, project_id, title, description, status, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(i1, projectId, "Busy1", "d", "in_progress", "user");
      db.prepare(
        "INSERT INTO Issue (id, project_id, title, description, status, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(i2, projectId, "Busy2", "d", "in_progress", "user");

      seedIssue("open");
      bus.emit("captain.assign", {
        project_id: projectId,
        issue_id: issueId,
        agent_id: agentId,
      });
      await flushPromises();

      const updated = db
        .prepare("SELECT status FROM Issue WHERE id = ?")
        .get(issueId) as { status: string };
      expect(updated.status).toBe("open"); // not assigned

      const queued = db
        .prepare("SELECT content FROM Comment WHERE issue_id = ? AND content LIKE '%queued%'")
        .get(issueId) as { content: string } | undefined;
      expect(queued).toBeDefined();

      db.prepare("DELETE FROM Issue WHERE id IN (?, ?)").run(i1, i2);
    });

    it("skips assign for non-assignable issue status", async () => {
      seedIssue("in_progress");
      bus.emit("captain.assign", {
        project_id: projectId,
        issue_id: issueId,
        agent_id: agentId,
      });
      await flushPromises();

      const updated = db
        .prepare("SELECT status FROM Issue WHERE id = ?")
        .get(issueId) as { status: string };
      expect(updated.status).toBe("in_progress");

      const spawnCalls = vi.mocked(adapter.spawn).mock.calls;
      const workerSpawn = spawnCalls.find((c) => c[0].sessionName.includes("worker"));
      expect(workerSpawn).toBeUndefined();
    });
  });

  // --- Captain CLI action: route_review ---

  describe("captain.route_review action", () => {
    it("transitions issue to in_review and creates reviewer IssueAgent", async () => {
      seedIssue("in_progress");
      bus.emit("captain.route_review", {
        project_id: projectId,
        issue_id: issueId,
        reviewer_agent_id: reviewerAgentId,
      });
      await flushPromises();

      const updated = db
        .prepare("SELECT status, current_review_round FROM Issue WHERE id = ?")
        .get(issueId) as { status: string; current_review_round: number };
      expect(updated.status).toBe("in_review");
      expect(updated.current_review_round).toBe(1);

      const ia = db
        .prepare("SELECT * FROM IssueAgent WHERE issue_id = ? AND role = 'reviewer'")
        .get(issueId) as { status: string; review_order: number } | undefined;
      expect(ia).toBeDefined();
      expect(ia!.review_order).toBe(1);
    });
  });

  // --- Review pipeline ---

  describe("review pipeline", () => {
    it("marks IssueAgent approved and issue ready when all reviewers approve", async () => {
      seedIssue("in_review");
      db.prepare("UPDATE Issue SET current_review_round = 1 WHERE id = ?").run(issueId);
      const iaId = crypto.randomUUID();
      db.prepare(
        "INSERT INTO IssueAgent (id, issue_id, agent_id, role, status, review_order, review_round, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(iaId, issueId, reviewerAgentId, "reviewer", "active", 1, 1, null);

      bus.emit("review.completed", {
        session_id: "s1",
        issue_id: issueId,
        agent_id: reviewerAgentId,
        project_id: projectId,
        verdict: "approved",
      });
      await flushPromises();

      const ia = db.prepare("SELECT status FROM IssueAgent WHERE id = ?").get(iaId) as { status: string };
      expect(ia.status).toBe("approved");

      const issue = db.prepare("SELECT status FROM Issue WHERE id = ?").get(issueId) as { status: string };
      expect(issue.status).toBe("ready");
    });

    it("marks IssueAgent changes_requested and issue feedback on changes_requested verdict", async () => {
      seedIssue("in_review");
      db.prepare("UPDATE Issue SET current_review_round = 1 WHERE id = ?").run(issueId);
      const iaId = crypto.randomUUID();
      db.prepare(
        "INSERT INTO IssueAgent (id, issue_id, agent_id, role, status, review_order, review_round, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(iaId, issueId, reviewerAgentId, "reviewer", "active", 1, 1, null);

      bus.emit("review.completed", {
        session_id: "s1",
        issue_id: issueId,
        agent_id: reviewerAgentId,
        project_id: projectId,
        verdict: "changes_requested",
      });
      await flushPromises();

      const ia = db.prepare("SELECT status FROM IssueAgent WHERE id = ?").get(iaId) as { status: string };
      expect(ia.status).toBe("changes_requested");

      const issue = db.prepare("SELECT status FROM Issue WHERE id = ?").get(issueId) as { status: string };
      expect(issue.status).toBe("feedback");
    });
  });

  // --- Error handling ---

  describe("error handling", () => {
    it("does not throw when spawn fails for captain session", async () => {
      vi.mocked(adapter.spawn).mockRejectedValue(new Error("tmux failed"));

      seedIssue();
      const issue = db.prepare("SELECT * FROM Issue WHERE id = ?").get(issueId) as Record<string, unknown>;
      expect(() => bus.emit("issue.created", { issue: issue as never })).not.toThrow();
      await flushPromises();
    });

    it("does not throw when send fails", async () => {
      vi.mocked(adapter.isAlive).mockResolvedValue(true);
      await manager.ensureCaptainSession(projectId);
      vi.mocked(adapter.send).mockRejectedValue(new Error("tmux send failed"));

      seedIssue();
      const issue = db.prepare("SELECT * FROM Issue WHERE id = ?").get(issueId) as Record<string, unknown>;
      expect(() => bus.emit("issue.created", { issue: issue as never })).not.toThrow();
      await flushPromises();
    });
  });
});
