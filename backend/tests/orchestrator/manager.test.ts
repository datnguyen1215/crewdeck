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
  agentId = crypto.randomUUID();
  reviewerAgentId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO Agent (id, crew_id, name, role, expertise, system_prompt, can_review) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    agentId,
    crewId,
    "Alice",
    "developer",
    JSON.stringify(["TypeScript"]),
    "You are Alice",
    0,
  );
  db.prepare(
    "INSERT INTO Agent (id, crew_id, name, role, expertise, system_prompt, can_review) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    reviewerAgentId,
    crewId,
    "Bob",
    "reviewer",
    JSON.stringify(["review"]),
    "You are Bob",
    1,
  );
}

function seedIssue(status = "open"): void {
  issueId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO Issue (id, project_id, title, description, status, created_by) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(issueId, projectId, "Fix auth bug", "OAuth is broken", status, "user");
}

function makeAdapter(): AgentAdapter {
  return {
    spawn: vi
      .fn()
      .mockResolvedValue({ sessionName: "test-session" } as SessionHandle),
    send: vi.fn().mockResolvedValue(undefined),
    getOutput: vi.fn().mockResolvedValue(""),
    isAlive: vi.fn().mockResolvedValue(true),
    kill: vi.fn().mockResolvedValue(undefined),
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("OrchestratorManager", () => {
  let bus: EventBus;
  let adapter: AgentAdapter;
  let mockClaude: ReturnType<typeof vi.fn>;
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
    adapter = makeAdapter();
    mockClaude = vi.fn().mockResolvedValue(
      JSON.stringify({
        action: "no_action",
        params: {},
        reasoning: "nothing",
      }),
    );
    manager = new OrchestratorManager(bus, adapter, mockClaude);
    manager.init();
  });

  afterEach(() => {
    mockClaude.mockReset();
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
      expect(mockClaude).toHaveBeenCalledOnce();
      expect(mockClaude.mock.calls[0][0] as string).toContain("Fix auth bug");
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
      expect(mockClaude).toHaveBeenCalledOnce();
    });

    it("resumes on review.completed", async () => {
      seedIssue("in_review");
      const iaId = crypto.randomUUID();
      db.prepare(
        "INSERT INTO IssueAgent (id, issue_id, agent_id, role, status, review_order, review_round, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(iaId, issueId, reviewerAgentId, "reviewer", "active", 1, 0, null);

      bus.emit("review.completed", {
        session_id: "s1",
        issue_id: issueId,
        agent_id: reviewerAgentId,
        project_id: projectId,
        verdict: "approved",
      });
      await flushPromises();
      expect(mockClaude).toHaveBeenCalledOnce();
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
      expect(mockClaude).not.toHaveBeenCalled();
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
      expect(mockClaude).not.toHaveBeenCalled();
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
      expect(mockClaude).toHaveBeenCalledOnce();
    });
  });

  // --- assign action ---

  describe("assign action", () => {
    it("updates issue to in_progress and creates IssueAgent", async () => {
      seedIssue("open");
      mockClaude.mockResolvedValue(
        JSON.stringify({
          action: "assign",
          params: { issue_id: issueId, agent_id: agentId },
          reasoning: "Best match",
        }),
      );

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
      mockClaude.mockResolvedValue(
        JSON.stringify({
          action: "assign",
          params: { issue_id: issueId, agent_id: agentId },
          reasoning: "Go",
        }),
      );

      const issue = db
        .prepare("SELECT * FROM Issue WHERE id = ?")
        .get(issueId) as Record<string, unknown>;
      bus.emit("issue.created", { issue: issue as never });
      await flushPromises();

      expect(adapter.spawn).toHaveBeenCalledOnce();
      const call = vi.mocked(adapter.spawn).mock.calls[0][0];
      expect(call.sessionName).toContain("worker");
      expect(call.env?.CREWDECK_AGENT_ID).toBe(agentId);
    });

    it("posts a comment after assign", async () => {
      seedIssue("open");
      mockClaude.mockResolvedValue(
        JSON.stringify({
          action: "assign",
          params: { issue_id: issueId, agent_id: agentId },
          reasoning: "Go",
        }),
      );

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
      mockClaude.mockResolvedValue(
        JSON.stringify({
          action: "assign",
          params: { issue_id: issueId, agent_id: agentId },
          reasoning: "Try to assign",
        }),
      );

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
      mockClaude.mockResolvedValue(
        JSON.stringify({
          action: "assign",
          params: { issue_id: issueId, agent_id: agentId },
          reasoning: "wrong state",
        }),
      );

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
      expect(adapter.spawn).not.toHaveBeenCalled();
    });
  });

  // --- route_review action ---

  describe("route_review action", () => {
    it("transitions issue to in_review and creates reviewer IssueAgent", async () => {
      seedIssue("in_progress");
      mockClaude.mockResolvedValue(
        JSON.stringify({
          action: "route_review",
          params: {
            issue_id: issueId,
            reviewer_agent_id: reviewerAgentId,
            review_order: 1,
          },
          reasoning: "Route to Bob",
        }),
      );

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

    it("rejects agent without can_review permission", async () => {
      seedIssue("in_progress");
      mockClaude.mockResolvedValue(
        JSON.stringify({
          action: "route_review",
          params: {
            issue_id: issueId,
            reviewer_agent_id: agentId,
            review_order: 1,
          },
          reasoning: "Alice can't review",
        }),
      );

      bus.emit("agent.finished", {
        session_id: "s1",
        agent_id: agentId,
        issue_id: issueId,
        project_id: projectId,
        role: "worker",
      });
      await flushPromises();

      const updated = db
        .prepare("SELECT status FROM Issue WHERE id = ?")
        .get(issueId) as { status: string };
      expect(updated.status).toBe("in_progress");
    });
  });

  // --- escalate action ---

  describe("escalate action", () => {
    it("posts escalation comment", async () => {
      seedIssue("in_review");
      mockClaude.mockResolvedValue(
        JSON.stringify({
          action: "escalate",
          params: { issue_id: issueId, reason: "Max rounds hit" },
          reasoning: "Escalate",
        }),
      );

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
      mockClaude.mockResolvedValue(
        JSON.stringify({
          action: "create_draft_issue",
          params: {
            title: "Refactor auth",
            description: "Needed",
            priority: 5,
          },
          reasoning: "Detected during review",
        }),
      );

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

      mockClaude.mockResolvedValue(
        JSON.stringify({
          action: "reorder",
          params: {
            issue_priorities: [
              { issue_id: i1, priority: 10 },
              { issue_id: i2, priority: 3 },
            ],
          },
          reasoning: "Prioritize",
        }),
      );

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
      const iaId = crypto.randomUUID();
      db.prepare(
        "INSERT INTO IssueAgent (id, issue_id, agent_id, role, status, review_order, review_round, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(iaId, issueId, reviewerAgentId, "reviewer", "active", 1, 0, null);

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
      const iaId = crypto.randomUUID();
      db.prepare(
        "INSERT INTO IssueAgent (id, issue_id, agent_id, role, status, review_order, review_round, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(iaId, issueId, reviewerAgentId, "reviewer", "active", 1, 0, null);

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
    it("skips second orchestrator run while first is still running", async () => {
      let resolve!: (v: string) => void;
      const slowPromise = new Promise<string>((r) => {
        resolve = r;
      });
      mockClaude.mockReturnValueOnce(slowPromise);

      seedIssue("open");
      const issue = db
        .prepare("SELECT * FROM Issue WHERE id = ?")
        .get(issueId) as Record<string, unknown>;

      bus.emit("issue.created", { issue: issue as never });
      bus.emit("issue.created", { issue: issue as never });
      await flushPromises();

      resolve(
        JSON.stringify({ action: "no_action", params: {}, reasoning: "ok" }),
      );
      await flushPromises();

      // Second event was skipped — only one Claude call
      expect(mockClaude).toHaveBeenCalledTimes(1);
    });
  });

  // --- error handling ---

  describe("error handling", () => {
    it("does not throw when Claude returns invalid JSON", async () => {
      seedIssue("open");
      mockClaude.mockResolvedValue("I cannot do this");

      const issue = db
        .prepare("SELECT * FROM Issue WHERE id = ?")
        .get(issueId) as Record<string, unknown>;
      expect(() =>
        bus.emit("issue.created", { issue: issue as never }),
      ).not.toThrow();
      await flushPromises();
    });

    it("does not throw when Claude call fails", async () => {
      seedIssue("open");
      mockClaude.mockRejectedValue(new Error("Claude unavailable"));

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
      mockClaude.mockResolvedValue(
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
