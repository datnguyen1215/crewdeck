import { describe, it, expect, beforeEach } from "vitest";
import {
  enqueue,
  dequeue,
  getQueuePosition,
  getQueueLength,
  peek,
  isQueued,
  clearQueue,
  clearAllQueues,
  getQueue,
  type QueuedDispatch,
} from "../../src/dispatch/queue.js";

const PROJECT_ID = "proj-1";
const PROJECT_ID_2 = "proj-2";

describe("dispatch/queue", () => {
  beforeEach(() => {
    clearAllQueues();
  });

  describe("enqueue", () => {
    it("adds dispatch to the queue and returns position", () => {
      const dispatch: QueuedDispatch = {
        projectId: PROJECT_ID,
        issueId: "issue-1",
        agentId: "engineer",
        queuedAt: new Date(),
      };
      const position = enqueue(dispatch);
      expect(position).toBe(0);
      expect(getQueueLength(PROJECT_ID)).toBe(1);
    });

    it("returns correct position for multiple enqueues", () => {
      const d1: QueuedDispatch = {
        projectId: PROJECT_ID,
        issueId: "issue-1",
        agentId: "engineer",
        queuedAt: new Date(),
      };
      const d2: QueuedDispatch = {
        projectId: PROJECT_ID,
        issueId: "issue-2",
        agentId: "captain",
        queuedAt: new Date(),
      };
      const d3: QueuedDispatch = {
        projectId: PROJECT_ID,
        issueId: "issue-3",
        agentId: "security",
        queuedAt: new Date(),
      };

      expect(enqueue(d1)).toBe(0);
      expect(enqueue(d2)).toBe(1);
      expect(enqueue(d3)).toBe(2);
      expect(getQueueLength(PROJECT_ID)).toBe(3);
    });

    it("stores commentAuthorAgentId when provided", () => {
      const dispatch: QueuedDispatch = {
        projectId: PROJECT_ID,
        issueId: "issue-1",
        agentId: "engineer",
        queuedAt: new Date(),
        commentAuthorAgentId: "captain",
      };
      enqueue(dispatch);
      const queue = getQueue(PROJECT_ID);
      expect(queue[0].commentAuthorAgentId).toBe("captain");
    });
  });

  describe("dequeue", () => {
    it("returns undefined for empty queue", () => {
      expect(dequeue(PROJECT_ID)).toBeUndefined();
    });

    it("returns and removes the first dispatch (FIFO)", () => {
      const d1: QueuedDispatch = {
        projectId: PROJECT_ID,
        issueId: "issue-1",
        agentId: "engineer",
        queuedAt: new Date(),
      };
      const d2: QueuedDispatch = {
        projectId: PROJECT_ID,
        issueId: "issue-2",
        agentId: "captain",
        queuedAt: new Date(),
      };

      enqueue(d1);
      enqueue(d2);

      const result = dequeue(PROJECT_ID);
      expect(result).toMatchObject({ issueId: "issue-1", agentId: "engineer" });
      expect(getQueueLength(PROJECT_ID)).toBe(1);

      const result2 = dequeue(PROJECT_ID);
      expect(result2).toMatchObject({ issueId: "issue-2", agentId: "captain" });
      expect(getQueueLength(PROJECT_ID)).toBe(0);
    });

    it("returns undefined for non-existent project", () => {
      expect(dequeue("non-existent")).toBeUndefined();
    });
  });

  describe("getQueuePosition", () => {
    it("returns -1 for empty queue", () => {
      expect(getQueuePosition(PROJECT_ID, "issue-1", "engineer")).toBe(-1);
    });

    it("returns correct position for queued dispatch", () => {
      enqueue({
        projectId: PROJECT_ID,
        issueId: "issue-1",
        agentId: "engineer",
        queuedAt: new Date(),
      });
      enqueue({
        projectId: PROJECT_ID,
        issueId: "issue-2",
        agentId: "captain",
        queuedAt: new Date(),
      });

      expect(getQueuePosition(PROJECT_ID, "issue-1", "engineer")).toBe(0);
      expect(getQueuePosition(PROJECT_ID, "issue-2", "captain")).toBe(1);
    });

    it("returns -1 for non-queued dispatch", () => {
      enqueue({
        projectId: PROJECT_ID,
        issueId: "issue-1",
        agentId: "engineer",
        queuedAt: new Date(),
      });
      expect(getQueuePosition(PROJECT_ID, "issue-2", "captain")).toBe(-1);
    });
  });

  describe("getQueueLength", () => {
    it("returns 0 for empty queue", () => {
      expect(getQueueLength(PROJECT_ID)).toBe(0);
    });

    it("returns correct count after enqueue/dequeue", () => {
      enqueue({
        projectId: PROJECT_ID,
        issueId: "issue-1",
        agentId: "engineer",
        queuedAt: new Date(),
      });
      expect(getQueueLength(PROJECT_ID)).toBe(1);

      enqueue({
        projectId: PROJECT_ID,
        issueId: "issue-2",
        agentId: "captain",
        queuedAt: new Date(),
      });
      expect(getQueueLength(PROJECT_ID)).toBe(2);

      dequeue(PROJECT_ID);
      expect(getQueueLength(PROJECT_ID)).toBe(1);
    });
  });

  describe("peek", () => {
    it("returns undefined for empty queue", () => {
      expect(peek(PROJECT_ID)).toBeUndefined();
    });

    it("returns the first dispatch without removing it", () => {
      enqueue({
        projectId: PROJECT_ID,
        issueId: "issue-1",
        agentId: "engineer",
        queuedAt: new Date(),
      });

      const peeked = peek(PROJECT_ID);
      expect(peeked).toMatchObject({ issueId: "issue-1", agentId: "engineer" });
      expect(getQueueLength(PROJECT_ID)).toBe(1);
    });
  });

  describe("isQueued", () => {
    it("returns false for empty queue", () => {
      expect(isQueued(PROJECT_ID, "issue-1", "engineer")).toBe(false);
    });

    it("returns true for queued dispatch", () => {
      enqueue({
        projectId: PROJECT_ID,
        issueId: "issue-1",
        agentId: "engineer",
        queuedAt: new Date(),
      });
      expect(isQueued(PROJECT_ID, "issue-1", "engineer")).toBe(true);
    });

    it("returns false for non-queued dispatch", () => {
      enqueue({
        projectId: PROJECT_ID,
        issueId: "issue-1",
        agentId: "engineer",
        queuedAt: new Date(),
      });
      expect(isQueued(PROJECT_ID, "issue-2", "captain")).toBe(false);
    });
  });

  describe("clearQueue", () => {
    it("removes all dispatches for a project", () => {
      enqueue({
        projectId: PROJECT_ID,
        issueId: "issue-1",
        agentId: "engineer",
        queuedAt: new Date(),
      });
      enqueue({
        projectId: PROJECT_ID,
        issueId: "issue-2",
        agentId: "captain",
        queuedAt: new Date(),
      });

      clearQueue(PROJECT_ID);
      expect(getQueueLength(PROJECT_ID)).toBe(0);
    });

    it("does not affect other projects", () => {
      enqueue({
        projectId: PROJECT_ID,
        issueId: "issue-1",
        agentId: "engineer",
        queuedAt: new Date(),
      });
      enqueue({
        projectId: PROJECT_ID_2,
        issueId: "issue-2",
        agentId: "captain",
        queuedAt: new Date(),
      });

      clearQueue(PROJECT_ID);
      expect(getQueueLength(PROJECT_ID)).toBe(0);
      expect(getQueueLength(PROJECT_ID_2)).toBe(1);
    });
  });

  describe("clearAllQueues", () => {
    it("removes all dispatches from all projects", () => {
      enqueue({
        projectId: PROJECT_ID,
        issueId: "issue-1",
        agentId: "engineer",
        queuedAt: new Date(),
      });
      enqueue({
        projectId: PROJECT_ID_2,
        issueId: "issue-2",
        agentId: "captain",
        queuedAt: new Date(),
      });

      clearAllQueues();
      expect(getQueueLength(PROJECT_ID)).toBe(0);
      expect(getQueueLength(PROJECT_ID_2)).toBe(0);
    });
  });

  describe("per-project isolation", () => {
    it("maintains separate queues for different projects", () => {
      enqueue({
        projectId: PROJECT_ID,
        issueId: "issue-1",
        agentId: "engineer",
        queuedAt: new Date(),
      });
      enqueue({
        projectId: PROJECT_ID_2,
        issueId: "issue-2",
        agentId: "captain",
        queuedAt: new Date(),
      });

      expect(getQueueLength(PROJECT_ID)).toBe(1);
      expect(getQueueLength(PROJECT_ID_2)).toBe(1);

      const d1 = dequeue(PROJECT_ID);
      expect(d1?.agentId).toBe("engineer");
      expect(getQueueLength(PROJECT_ID)).toBe(0);
      expect(getQueueLength(PROJECT_ID_2)).toBe(1);
    });
  });

  describe("getQueue", () => {
    it("returns empty array for non-existent project", () => {
      expect(getQueue("non-existent")).toEqual([]);
    });

    it("returns readonly copy of the queue", () => {
      enqueue({
        projectId: PROJECT_ID,
        issueId: "issue-1",
        agentId: "engineer",
        queuedAt: new Date(),
      });
      const queue = getQueue(PROJECT_ID);
      expect(queue).toHaveLength(1);
      expect(queue[0].agentId).toBe("engineer");
    });
  });
});
