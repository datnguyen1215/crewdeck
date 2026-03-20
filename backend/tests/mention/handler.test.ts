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
import { MentionHandler } from "../../src/mention/handler.js";
import type { AgentAdapter, SessionHandle } from "../../src/agent/types.js";

// --- DB helpers ---

let projectId: string;
let crewId: string;
let captainId: string;
let engineerId: string;
let securityId: string;
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
  engineerId = crypto.randomUUID();
  securityId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO Agent (id, crew_id, name, title, description, system_prompt, is_captain) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(captainId, crewId, "Captain", "project coordinator", null, "You are the captain.", 1);
  db.prepare(
    "INSERT INTO Agent (id, crew_id, name, title, description, system_prompt) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(engineerId, crewId, "Engineer", "developer", null, "You are Engineer");
  db.prepare(
    "INSERT INTO Agent (id, crew_id, name, title, description, system_prompt) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(securityId, crewId, "Security", "security specialist", null, "You are Security");
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

describe("MentionHandler", () => {
  let bus: EventBus;
  let adapter: AgentAdapter;
  let handler: MentionHandler;

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

    bus = new EventBus();
    adapter = makeAdapter();
    handler = new MentionHandler(bus, adapter);
    handler.init();
  });

  afterEach(() => {
    handler.stop(); // Clean up interval to prevent test pollution
    vi.restoreAllMocks();
  });

  describe("comment handling", () => {
    it("ignores user comments (only processes agent comments)", async () => {
      seedIssue();
      bus.emit("comment.added", {
        comment: {
          id: "c1",
          issue_id: issueId,
          author_type: "user",
          author_id: null,
          content: "@engineer please help",
          created_at: "",
        },
        project_id: projectId,
      });
      await flushPromises();

      expect(adapter.spawn).not.toHaveBeenCalled();
    });

    it("spawns mentioned agents from agent comments", async () => {
      seedIssue();
      bus.emit("comment.added", {
        comment: {
          id: "c1",
          issue_id: issueId,
          author_type: "agent",
          author_id: captainId,
          content: "@engineer please implement this feature",
          created_at: "",
        },
        project_id: projectId,
      });
      await flushPromises();

      expect(adapter.spawn).toHaveBeenCalledTimes(1);
      const call = vi.mocked(adapter.spawn).mock.calls[0][0];
      expect(call.env?.CREWDECK_AGENT_ID).toBe(engineerId);
    });

    it("skips self-mentions", async () => {
      seedIssue();
      bus.emit("comment.added", {
        comment: {
          id: "c1",
          issue_id: issueId,
          author_type: "agent",
          author_id: captainId,
          content: "I am @captain and I need @engineer to help",
          created_at: "",
        },
        project_id: projectId,
      });
      await flushPromises();

      // Should only spawn engineer, not captain
      expect(adapter.spawn).toHaveBeenCalledTimes(1);
      const call = vi.mocked(adapter.spawn).mock.calls[0][0];
      expect(call.env?.CREWDECK_AGENT_ID).toBe(engineerId);
    });

    it("spawns multiple agents when multiple mentions", async () => {
      seedIssue();
      bus.emit("comment.added", {
        comment: {
          id: "c1",
          issue_id: issueId,
          author_type: "agent",
          author_id: captainId,
          content: "@engineer implement and @security review",
          created_at: "",
        },
        project_id: projectId,
      });
      await flushPromises();

      expect(adapter.spawn).toHaveBeenCalledTimes(2);
    });

    it("ignores mentions of non-existent agents", async () => {
      seedIssue();
      bus.emit("comment.added", {
        comment: {
          id: "c1",
          issue_id: issueId,
          author_type: "agent",
          author_id: captainId,
          content: "@nonexistent please help",
          created_at: "",
        },
        project_id: projectId,
      });
      await flushPromises();

      expect(adapter.spawn).not.toHaveBeenCalled();
    });
  });

  describe("dedup guard", () => {
    it("prevents duplicate spawns of same agent on same issue", async () => {
      seedIssue();

      // First spawn
      bus.emit("comment.added", {
        comment: {
          id: "c1",
          issue_id: issueId,
          author_type: "agent",
          author_id: captainId,
          content: "@engineer please help",
          created_at: "",
        },
        project_id: projectId,
      });
      await flushPromises();

      expect(adapter.spawn).toHaveBeenCalledTimes(1);

      // Second spawn attempt for same agent on same issue
      bus.emit("comment.added", {
        comment: {
          id: "c2",
          issue_id: issueId,
          author_type: "agent",
          author_id: captainId,
          content: "@engineer please help again",
          created_at: "",
        },
        project_id: projectId,
      });
      await flushPromises();

      // Should still be 1 (dedup prevented second spawn)
      expect(adapter.spawn).toHaveBeenCalledTimes(1);
    });
  });

  describe("batch tracking", () => {
    it("creates batch when multiple agents spawned", async () => {
      seedIssue();
      bus.emit("comment.added", {
        comment: {
          id: "c1",
          issue_id: issueId,
          author_type: "agent",
          author_id: captainId,
          content: "@engineer and @security please review",
          created_at: "",
        },
        project_id: projectId,
      });
      await flushPromises();

      expect(adapter.spawn).toHaveBeenCalledTimes(2);

      // Check batch was created by verifying originator is blocked
      expect(handler.hasPendingBatchForOriginator(issueId, captainId)).toBe(true);
    });

    it("filters out batch originator from subsequent mentions", async () => {
      seedIssue();

      // Captain spawns batch of reviewers
      bus.emit("comment.added", {
        comment: {
          id: "c1",
          issue_id: issueId,
          author_type: "agent",
          author_id: captainId,
          content: "@engineer and @security please review",
          created_at: "",
        },
        project_id: projectId,
      });
      await flushPromises();

      expect(adapter.spawn).toHaveBeenCalledTimes(2);

      // Engineer finishes and tries to mention @captain
      bus.emit("comment.added", {
        comment: {
          id: "c2",
          issue_id: issueId,
          author_type: "agent",
          author_id: engineerId,
          content: "@captain I've completed my review",
          created_at: "",
        },
        project_id: projectId,
      });
      await flushPromises();

      // Captain should NOT be spawned (filtered as batch originator)
      // spawn count should still be 2
      expect(adapter.spawn).toHaveBeenCalledTimes(2);
    });

    it("auto-spawns originator when batch completes", async () => {
      seedIssue();

      // Captain spawns batch
      bus.emit("comment.added", {
        comment: {
          id: "c1",
          issue_id: issueId,
          author_type: "agent",
          author_id: captainId,
          content: "@engineer and @security please review",
          created_at: "",
        },
        project_id: projectId,
      });
      await flushPromises();

      expect(adapter.spawn).toHaveBeenCalledTimes(2);

      // Get session IDs for the spawned agents
      const sessions = db
        .prepare("SELECT * FROM Session WHERE issue_id = ? AND status = 'running'")
        .all(issueId) as Array<{ id: string; agent_id: string }>;

      // Mark both agents as finished
      for (const session of sessions) {
        bus.emit("agent.finished", {
          session_id: session.id,
          agent_id: session.agent_id,
          issue_id: issueId,
          project_id: projectId,
          role: "mention",
        });
      }
      await flushPromises();

      // Captain should be auto-spawned (3rd spawn)
      expect(adapter.spawn).toHaveBeenCalledTimes(3);
      const lastCall = vi.mocked(adapter.spawn).mock.calls[2][0];
      expect(lastCall.env?.CREWDECK_AGENT_ID).toBe(captainId);
    });
  });

  describe("batch timeout", () => {
    it("cleans up stale batches and auto-spawns originator", async () => {
      seedIssue();

      // Captain spawns batch
      bus.emit("comment.added", {
        comment: {
          id: "c1",
          issue_id: issueId,
          author_type: "agent",
          author_id: captainId,
          content: "@engineer and @security please review",
          created_at: "",
        },
        project_id: projectId,
      });
      await flushPromises();

      expect(adapter.spawn).toHaveBeenCalledTimes(2);
      expect(handler.hasPendingBatchForOriginator(issueId, captainId)).toBe(true);

      // Simulate batch timing out by setting createdAt to the past
      // Access private batches map via type assertion for testing
      const handlerAny = handler as unknown as {
        batches: Map<string, { createdAt: Date }>;
        cleanupStaleBatches: () => void;
      };
      for (const batch of handlerAny.batches.values()) {
        batch.createdAt = new Date(Date.now() - 31 * 60 * 1000); // 31 minutes ago
      }

      // Trigger cleanup manually (instead of waiting for interval)
      handlerAny.cleanupStaleBatches();
      await flushPromises();

      // Batch should be cleaned up
      expect(handler.hasPendingBatchForOriginator(issueId, captainId)).toBe(false);

      // Originator should be auto-spawned (3rd spawn)
      expect(adapter.spawn).toHaveBeenCalledTimes(3);
      const lastCall = vi.mocked(adapter.spawn).mock.calls[2][0];
      expect(lastCall.env?.CREWDECK_AGENT_ID).toBe(captainId);
    });
  });

  describe("edge cases", () => {
    it("handles comment with no mentions gracefully", async () => {
      seedIssue();
      bus.emit("comment.added", {
        comment: {
          id: "c1",
          issue_id: issueId,
          author_type: "agent",
          author_id: captainId,
          content: "Just a regular comment",
          created_at: "",
        },
        project_id: projectId,
      });
      await flushPromises();

      expect(adapter.spawn).not.toHaveBeenCalled();
    });

    it("handles spawn failure gracefully", async () => {
      seedIssue();
      vi.mocked(adapter.spawn).mockRejectedValueOnce(new Error("spawn failed"));

      expect(() => {
        bus.emit("comment.added", {
          comment: {
            id: "c1",
            issue_id: issueId,
            author_type: "agent",
            author_id: captainId,
            content: "@engineer please help",
            created_at: "",
          },
          project_id: projectId,
        });
      }).not.toThrow();

      await flushPromises();
    });
  });
});
