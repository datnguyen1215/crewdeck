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
  // Captain agent — coordinates the crew
  db.prepare(
    "INSERT INTO Agent (id, crew_id, name, title, description, system_prompt, is_captain) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    captainId,
    crewId,
    "Captain",
    "project coordinator",
    null,
    "You are the captain.",
    1,
  );
  db.prepare(
    "INSERT INTO Agent (id, crew_id, name, title, description, system_prompt) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    agentId,
    crewId,
    "Alice",
    "developer",
    null,
    "You are Alice",
  );
  db.prepare(
    "INSERT INTO Agent (id, crew_id, name, title, description, system_prompt) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    reviewerAgentId,
    crewId,
    "Bob",
    "reviewer",
    null,
    "You are Bob",
  );
}

function seedIssue(status = "open"): void {
  issueId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO Issue (id, project_id, title, description, status, created_by) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(issueId, projectId, "Fix auth bug", "OAuth is broken", status, "user");
}

/** Create a mock adapter where getOutput returns the given JSON and isAlive returns false (session exited). */
function makeAdapter(outputJson?: string): AgentAdapter {
  return {
    spawn: vi
      .fn()
      .mockResolvedValue({ sessionName: "test-session" } as SessionHandle),
    send: vi.fn().mockResolvedValue(undefined),
    getOutput: vi.fn().mockResolvedValue(outputJson ?? ""),
    isAlive: vi.fn().mockResolvedValue(false),
    kill: vi.fn().mockResolvedValue(undefined),
  };
}

function flushPromises(): Promise<void> {
  // The orchestrator polls isAlive at 500ms intervals; since isAlive
  // is mocked to return false immediately, we need to wait >500ms for
  // the poll delay + await chain to fully resolve.
  return new Promise((resolve) => setTimeout(resolve, 700));
}

const DEFAULT_RESPONSE = JSON.stringify({
  action: "no_action",
  params: {},
  reasoning: "nothing",
});

describe("OrchestratorManager", () => {
  let bus: EventBus;
  let adapter: AgentAdapter;
  let manager: OrchestratorManager;

  beforeAll(() => {
    seedProject();
    seedAgents();
  });

  beforeEach(() => {
    // Clean up per-test records to avoid state leakage between tests
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
    adapter = makeAdapter(DEFAULT_RESPONSE);
    manager = new OrchestratorManager(bus, adapter);
    manager.init();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Event subscription tests ---

  describe("event subscriptions", () => {
    it("resumes on issue.created", async () => {
      seedIssue();
      const issue = db
        .prepare("SELECT * FROM Issue WHERE id = ?")
        .get(issueId) as Record<string, unknown>;
      bus.emit("issue.created", { issue: issue as never });
      await flushPromises();
      // The orchestrator should have spawned a tmux session with --print
      expect(adapter.spawn).toHaveBeenCalled();
      const call = vi.mocked(adapter.spawn).mock.calls[0][0];
      expect(call.print).toBe(true);
      expect(call.prompt).toContain("Fix auth bug");
    });

    it("resumes on agent.finished", async () => {
      seedIssue("in_progress");
      bus.emit("agent.finished", {
        session_id: "s1",
        agent_id: agentId,
        issue_id: issueId,
        project_id: projectId,
        role: "worker",
      });
      await flushPromises();
      expect(adapter.spawn).toHaveBeenCalled();
    });

    it("resumes on review.completed", async () => {
      seedIssue("in_review");
      db.prepare("UPDATE Issue SET current_review_round = 1 WHERE id = ?").run(issueId);
      const iaId = crypto.randomUUID();
      db.prepare(
        "INSERT INTO IssueAgent (id, issue_id, agent_id, role, status, review_order, review_round, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(iaId, issueId, reviewerAgentId, "reviewer", "active", 1, 1, null);

      bus.emit("review.completed", {
        session_id: "s1",
        issue_id: issueId,
        agent_id: reviewerAgentId,
        project_id: projectId,
        verdict: "approved",
      });
      await flushPromises();
      expect(adapter.spawn).toHaveBeenCalled();
    });

    it("does not resume on orchestrator/agent comments", async () => {
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
      expect(adapter.spawn).not.toHaveBeenCalled();
    });

    it("does not resume on orchestrator-created issues", async () => {
      seedIssue();
      db.prepare(
        "UPDATE Issue SET created_by = 'orchestrator' WHERE id = ?",
      ).run(issueId);
      const issue = db
        .prepare("SELECT * FROM Issue WHERE id = ?")
        .get(issueId) as Record<string, unknown>;
      bus.emit("issue.created", { issue: issue as never });
      await flushPromises();
      expect(adapter.spawn).not.toHaveBeenCalled();
    });

    it("resumes on user comment.added", async () => {
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
      expect(adapter.spawn).toHaveBeenCalled();
    });
  });

  // --- assign action ---

  describe("assign action", () => {
    it("updates issue to in_progress and creates IssueAgent", async () => {
      seedIssue("open");
      const response = JSON.stringify({
        action: "assign",
        params: { issue_id: issueId, agent_id: agentId },
        reasoning: "Best match",
      });
      vi.mocked(adapter.getOutput).mockResolvedValue(response);

      const issue = db
        .prepare("SELECT * FROM Issue WHERE id = ?")
        .get(issueId) as Record<string, unknown>;
      bus.emit("issue.created", { issue: issue as never });
      await flushPromises();

      const updated = db
        .prepare("SELECT status, assigned_agent_id FROM Issue WHERE id = ?")
        .get(issueId) as { status: string; assigned_agent_id: string };
      expect(updated.status).toBe("in_progress");
      expect(updated.assigned_agent_id).toBe(agentId);

      const ia = db
        .prepare(
          "SELECT * FROM IssueAgent WHERE issue_id = ? AND role = 'worker'",
        )
        .get(issueId) as { status: string } | undefined;
      expect(ia).toBeDefined();
      expect(ia!.status).toBe("active");
    });

    it("spawns an agent session", async () => {
      seedIssue("open");
      const response = JSON.stringify({
        action: "assign",
        params: { issue_id: issueId, agent_id: agentId },
        reasoning: "Go",
      });
      vi.mocked(adapter.getOutput).mockResolvedValue(response);

      const issue = db
        .prepare("SELECT * FROM Issue WHERE id = ?")
        .get(issueId) as Record<string, unknown>;
      bus.emit("issue.created", { issue: issue as never });
      await flushPromises();

      // spawn is called twice: once for orchestrator tmux, once for agent
      const spawnCalls = vi.mocked(adapter.spawn).mock.calls;
      const agentSpawn = spawnCalls.find((c) => c[0].sessionName.includes("worker"));
      expect(agentSpawn).toBeDefined();
      expect(agentSpawn![0].env?.CREWDECK_AGENT_ID).toBe(agentId);
    });

    it("posts a comment after assign", async () => {
      seedIssue("open");
      const response = JSON.stringify({
        action: "assign",
        params: { issue_id: issueId, agent_id: agentId },
        reasoning: "Go",
      });
      vi.mocked(adapter.getOutput).mockResolvedValue(response);

      const issue = db
        .prepare("SELECT * FROM Issue WHERE id = ?")
        .get(issueId) as Record<string, unknown>;
      bus.emit("issue.created", { issue: issue as never });
      await flushPromises();

      const comments = db
        .prepare(
          "SELECT content FROM Comment WHERE issue_id = ? AND author_type = 'orchestrator'",
        )
        .all(issueId) as Array<{ content: string }>;
      expect(comments.length).toBeGreaterThan(0);
      expect(comments[0].content).toContain("Alice");
    });

    it("enforces concurrency limit", async () => {
      // Fill concurrency (max = 2)
      const i1 = crypto.randomUUID();
      const i2 = crypto.randomUUID();
      db.prepare(
        "INSERT INTO Issue (id, project_id, title, description, status, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(i1, projectId, "Busy1", "d", "in_progress", "user");
      db.prepare(
        "INSERT INTO Issue (id, project_id, title, description, status, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(i2, projectId, "Busy2", "d", "in_progress", "user");

      seedIssue("open");
      const response = JSON.stringify({
        action: "assign",
        params: { issue_id: issueId, agent_id: agentId },
        reasoning: "Try to assign",
      });
      vi.mocked(adapter.getOutput).mockResolvedValue(response);

      const issue = db
        .prepare("SELECT * FROM Issue WHERE id = ?")
        .get(issueId) as Record<string, unknown>;
      bus.emit("issue.created", { issue: issue as never });
      await flushPromises();

      const updated = db
        .prepare("SELECT status FROM Issue WHERE id = ?")
        .get(issueId) as { status: string };
      expect(updated.status).toBe("open"); // not assigned

      const queued = db
        .prepare(
          "SELECT content FROM Comment WHERE issue_id = ? AND content LIKE '%queued%'",
        )
        .get(issueId) as { content: string } | undefined;
      expect(queued).toBeDefined();

      db.prepare("DELETE FROM Issue WHERE id IN (?, ?)").run(i1, i2);
    });

    it("skips assign for non-assignable issue status", async () => {
      seedIssue("in_progress");
      const response = JSON.stringify({
        action: "assign",
        params: { issue_id: issueId, agent_id: agentId },
        reasoning: "wrong state",
      });
      vi.mocked(adapter.getOutput).mockResolvedValue(response);

      bus.emit("agent.finished", {
        session_id: "s1",
        agent_id: agentId,
        issue_id: issueId,
        project_id: projectId,
        role: "worker",
      });
      await flushPromises();

      // Status should remain in_progress (no double-assign)
      const updated = db
        .prepare("SELECT status FROM Issue WHERE id = ?")
        .get(issueId) as { status: string };
      expect(updated.status).toBe("in_progress");
      // spawn is called once for orchestrator, but NOT for an agent session
      const spawnCalls = vi.mocked(adapter.spawn).mock.calls;
      const agentSpawn = spawnCalls.find((c) => c[0].sessionName.includes("worker"));
      expect(agentSpawn).toBeUndefined();
    });
  });

  // --- route_review action ---

  describe("route_review action", () => {
    it("transitions issue to in_review and creates reviewer IssueAgent", async () => {
      seedIssue("in_progress");
      const response = JSON.stringify({
        action: "route_review",
        params: {
          issue_id: issueId,
          reviewer_agent_id: reviewerAgentId,
          review_order: 1,
        },
        reasoning: "Route to Bob",
      });
      vi.mocked(adapter.getOutput).mockResolvedValue(response);

      bus.emit("agent.finished", {
        session_id: "s1",
        agent_id: agentId,
        issue_id: issueId,
        project_id: projectId,
        role: "worker",
      });
      await flushPromises();

      const updated = db
        .prepare("SELECT status, current_review_round FROM Issue WHERE id = ?")
        .get(issueId) as { status: string; current_review_round: number };
      expect(updated.status).toBe("in_review");
      expect(updated.current_review_round).toBe(1);

      const ia = db
        .prepare(
          "SELECT * FROM IssueAgent WHERE issue_id = ? AND role = 'reviewer'",
        )
        .get(issueId) as { status: string; review_order: number } | undefined;
      expect(ia).toBeDefined();
      expect(ia!.review_order).toBe(1);
    });

  });

  // --- escalate action ---

  describe("escalate action", () => {
    it("posts escalation comment", async () => {
      seedIssue("in_review");
      const response = JSON.stringify({
        action: "escalate",
        params: { issue_id: issueId, reason: "Max rounds hit" },
        reasoning: "Escalate",
      });
      vi.mocked(adapter.getOutput).mockResolvedValue(response);

      bus.emit("agent.finished", {
        session_id: "s1",
        agent_id: agentId,
        issue_id: issueId,
        project_id: projectId,
        role: "worker",
      });
      await flushPromises();

      const comments = db
        .prepare(
          "SELECT content FROM Comment WHERE issue_id = ? AND content LIKE '%Escalated%'",
        )
        .all(issueId) as Array<{ content: string }>;
      expect(comments.length).toBeGreaterThan(0);
      expect(comments[0].content).toContain("Max rounds hit");
    });
  });

  // --- create_draft_issue action ---

  describe("create_draft_issue action", () => {
    it("creates issue with draft status and orchestrator author", async () => {
      seedIssue("open");
      const response = JSON.stringify({
        action: "create_draft_issue",
        params: {
          title: "Refactor auth",
          description: "Needed",
          priority: 5,
        },
        reasoning: "Detected during review",
      });
      vi.mocked(adapter.getOutput).mockResolvedValue(response);

      const issue = db
        .prepare("SELECT * FROM Issue WHERE id = ?")
        .get(issueId) as Record<string, unknown>;
      bus.emit("issue.created", { issue: issue as never });
      await flushPromises();

      const drafted = db
        .prepare(
          "SELECT status, created_by, priority FROM Issue WHERE project_id = ? AND title = 'Refactor auth'",
        )
        .get(projectId) as
        | { status: string; created_by: string; priority: number }
        | undefined;
      expect(drafted).toBeDefined();
      expect(drafted!.status).toBe("draft");
      expect(drafted!.created_by).toBe("orchestrator");
      expect(drafted!.priority).toBe(5);
    });
  });

  // --- reorder action ---

  describe("reorder action", () => {
    it("updates issue priorities", async () => {
      const i1 = crypto.randomUUID();
      const i2 = crypto.randomUUID();
      db.prepare(
        "INSERT INTO Issue (id, project_id, title, description, status, created_by, priority) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(i1, projectId, "P1", "d", "open", "user", 0);
      db.prepare(
        "INSERT INTO Issue (id, project_id, title, description, status, created_by, priority) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(i2, projectId, "P2", "d", "open", "user", 0);

      const response = JSON.stringify({
        action: "reorder",
        params: {
          issue_priorities: [
            { issue_id: i1, priority: 10 },
            { issue_id: i2, priority: 3 },
          ],
        },
        reasoning: "Prioritize",
      });
      vi.mocked(adapter.getOutput).mockResolvedValue(response);

      bus.emit("comment.added", {
        comment: {
          id: "cx",
          issue_id: i1,
          author_type: "user",
          author_id: null,
          content: "Reprioritize please",
          created_at: "",
        },
        project_id: projectId,
      });
      await flushPromises();

      const p1 = db
        .prepare("SELECT priority FROM Issue WHERE id = ?")
        .get(i1) as { priority: number };
      const p2 = db
        .prepare("SELECT priority FROM Issue WHERE id = ?")
        .get(i2) as { priority: number };
      expect(p1.priority).toBe(10);
      expect(p2.priority).toBe(3);
    });
  });

  // --- review pipeline ---

  describe("review pipeline", () => {
    it("marks IssueAgent approved and issue ready when all reviewers approve", async () => {
      seedIssue("in_review");
      db.prepare("UPDATE Issue SET current_review_round = 1 WHERE id = ?").run(issueId);
      const iaId = crypto.randomUUID();
      db.prepare(
        "INSERT INTO IssueAgent (id, issue_id, agent_id, role, status, review_order, review_round, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(iaId, issueId, reviewerAgentId, "reviewer", "active", 1, 1, null);

      bus.emit("review.completed", {
        session_id: "s1",
        issue_id: issueId,
        agent_id: reviewerAgentId,
        project_id: projectId,
        verdict: "approved",
      });
      await flushPromises();

      const ia = db
        .prepare("SELECT status FROM IssueAgent WHERE id = ?")
        .get(iaId) as { status: string };
      expect(ia.status).toBe("approved");

      const issue = db
        .prepare("SELECT status FROM Issue WHERE id = ?")
        .get(issueId) as { status: string };
      expect(issue.status).toBe("ready");
    });

    it("marks IssueAgent changes_requested and issue feedback on changes_requested verdict", async () => {
      seedIssue("in_review");
      db.prepare("UPDATE Issue SET current_review_round = 1 WHERE id = ?").run(issueId);
      const iaId = crypto.randomUUID();
      db.prepare(
        "INSERT INTO IssueAgent (id, issue_id, agent_id, role, status, review_order, review_round, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(iaId, issueId, reviewerAgentId, "reviewer", "active", 1, 1, null);

      bus.emit("review.completed", {
        session_id: "s1",
        issue_id: issueId,
        agent_id: reviewerAgentId,
        project_id: projectId,
        verdict: "changes_requested",
      });
      await flushPromises();

      const ia = db
        .prepare("SELECT status FROM IssueAgent WHERE id = ?")
        .get(iaId) as { status: string };
      expect(ia.status).toBe("changes_requested");

      const issue = db
        .prepare("SELECT status FROM Issue WHERE id = ?")
        .get(issueId) as { status: string };
      expect(issue.status).toBe("feedback");
    });
  });

  // --- concurrency guard ---

  describe("concurrency guard", () => {
    it("prevents concurrent runs but re-runs sequentially after first completes", async () => {
      // Make isAlive return true initially, then false after a delay
      let spawnCount = 0;
      let resolveFirst!: () => void;
      const firstRunWait = new Promise<void>((r) => { resolveFirst = r; });

      vi.mocked(adapter.isAlive).mockImplementation(async () => {
        // First orchestrator run: block until we resolve
        if (spawnCount <= 1) {
          await firstRunWait;
          return false;
        }
        return false;
      });
      vi.mocked(adapter.spawn).mockImplementation(async () => {
        spawnCount++;
        return { sessionName: "test" };
      });

      seedIssue("open");
      const issue = db
        .prepare("SELECT * FROM Issue WHERE id = ?")
        .get(issueId) as Record<string, unknown>;

      bus.emit("issue.created", { issue: issue as never });
      bus.emit("issue.created", { issue: issue as never });
      await new Promise((r) => setTimeout(r, 10));

      // While first run is blocked, only one spawn should have happened
      expect(spawnCount).toBe(1);

      resolveFirst();
      // Wait long enough for the first run to finish + the re-run's 500ms poll interval
      await new Promise((r) => setTimeout(r, 1500));

      // After first run finishes, the queued re-run fires
      expect(spawnCount).toBe(2);
    });
  });

  // --- error handling ---

  describe("error handling", () => {
    it("does not throw when Claude returns invalid output", async () => {
      seedIssue("open");
      vi.mocked(adapter.getOutput).mockResolvedValue("I cannot do this");

      const issue = db
        .prepare("SELECT * FROM Issue WHERE id = ?")
        .get(issueId) as Record<string, unknown>;
      expect(() =>
        bus.emit("issue.created", { issue: issue as never }),
      ).not.toThrow();
      await flushPromises();
    });

    it("does not throw when spawn fails", async () => {
      seedIssue("open");
      vi.mocked(adapter.spawn).mockRejectedValue(new Error("tmux failed"));

      const issue = db
        .prepare("SELECT * FROM Issue WHERE id = ?")
        .get(issueId) as Record<string, unknown>;
      expect(() =>
        bus.emit("issue.created", { issue: issue as never }),
      ).not.toThrow();
      await flushPromises();
    });

    it("emits orchestrator.decision event on valid action", async () => {
      seedIssue("open");
      vi.mocked(adapter.getOutput).mockResolvedValue(
        JSON.stringify({
          action: "no_action",
          params: {},
          reasoning: "quiet",
        }),
      );

      const decisions: unknown[] = [];
      bus.on("orchestrator.decision", (d) => decisions.push(d));

      const issue = db
        .prepare("SELECT * FROM Issue WHERE id = ?")
        .get(issueId) as Record<string, unknown>;
      bus.emit("issue.created", { issue: issue as never });
      await flushPromises();

      expect(decisions).toHaveLength(1);
      expect((decisions[0] as { action: string }).action).toBe("no_action");
    });
  });
});
