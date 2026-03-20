import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { EventBus } from "../../src/events/bus.js";
import {
  subscribers,
  addSubscriber,
  removeSubscriber,
  broadcast,
  subscribeEvents,
} from "../../src/websocket.js";

// Mock a WebSocket client with controllable state
function mockWs(readyState = WebSocket.OPEN): WebSocket {
  return {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn(),
    ping: vi.fn(),
  } as unknown as WebSocket;
}

describe("subscriber management", () => {
  afterEach(() => {
    subscribers.clear();
  });

  it("addSubscriber creates a new set for unknown project", () => {
    const ws = mockWs();
    addSubscriber("p1", ws);
    expect(subscribers.get("p1")?.has(ws)).toBe(true);
  });

  it("addSubscriber adds to existing set", () => {
    const ws1 = mockWs();
    const ws2 = mockWs();
    addSubscriber("p1", ws1);
    addSubscriber("p1", ws2);
    expect(subscribers.get("p1")?.size).toBe(2);
  });

  it("removeSubscriber removes the client", () => {
    const ws = mockWs();
    addSubscriber("p1", ws);
    removeSubscriber("p1", ws);
    expect(subscribers.has("p1")).toBe(false);
  });

  it("removeSubscriber removes project entry when last client leaves", () => {
    const ws1 = mockWs();
    const ws2 = mockWs();
    addSubscriber("p1", ws1);
    addSubscriber("p1", ws2);
    removeSubscriber("p1", ws1);
    expect(subscribers.has("p1")).toBe(true);
    removeSubscriber("p1", ws2);
    expect(subscribers.has("p1")).toBe(false);
  });

  it("removeSubscriber is safe for unknown project", () => {
    expect(() => removeSubscriber("nonexistent", mockWs())).not.toThrow();
  });

  it("subscribers are scoped to project — p1 clients don't see p2 messages", () => {
    const ws1 = mockWs();
    const ws2 = mockWs();
    addSubscriber("p1", ws1);
    addSubscriber("p2", ws2);
    broadcast("p1", "test.event", { val: 1 });
    expect((ws1.send as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect((ws2.send as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe("broadcast", () => {
  afterEach(() => {
    subscribers.clear();
  });

  it("sends JSON message to all subscribers of a project", () => {
    const ws1 = mockWs();
    const ws2 = mockWs();
    addSubscriber("p1", ws1);
    addSubscriber("p1", ws2);
    broadcast("p1", "issue.created", { id: "i1" });
    expect((ws1.send as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect((ws2.send as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it("message contains event, data, and ISO timestamp", () => {
    const ws = mockWs();
    addSubscriber("p1", ws);
    broadcast("p1", "issue.created", { id: "i1" });
    const raw = (ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const msg = JSON.parse(raw);
    expect(msg.event).toBe("issue.created");
    expect(msg.data).toEqual({ id: "i1" });
    expect(typeof msg.timestamp).toBe("string");
    expect(() => new Date(msg.timestamp)).not.toThrow();
  });

  it("skips clients that are not OPEN", () => {
    const ws = mockWs(WebSocket.CLOSED);
    addSubscriber("p1", ws);
    broadcast("p1", "issue.created", { id: "i1" });
    expect((ws.send as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("removes subscriber and does not throw when send fails", () => {
    const ws = mockWs();
    (ws.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("broken pipe");
    });
    addSubscriber("p1", ws);
    expect(() => broadcast("p1", "issue.created", {})).not.toThrow();
    expect(subscribers.has("p1")).toBe(false);
  });

  it("does nothing when no subscribers for project", () => {
    expect(() => broadcast("unknown", "event", {})).not.toThrow();
  });
});

describe("event bus bridge", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
    subscribers.clear();
    subscribeEvents(bus);
  });

  afterEach(() => {
    subscribers.clear();
  });

  // Helper to capture last sent message
  function lastMessage(ws: WebSocket): Record<string, unknown> {
    const calls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
    return JSON.parse(calls[calls.length - 1][0] as string);
  }

  it("issue.created broadcasts full issue object", () => {
    const ws = mockWs();
    addSubscriber("p1", ws);
    bus.emit("issue.created", { issue: { id: "i1", project_id: "p1" } as never });
    const msg = lastMessage(ws);
    expect(msg.event).toBe("issue.created");
    expect((msg.data as Record<string, unknown>).id).toBe("i1");
  });

  it("issue.status_changed broadcasts { issue_id, from, to }", () => {
    const ws = mockWs();
    addSubscriber("p1", ws);
    bus.emit("issue.status_changed", { issue_id: "i1", project_id: "p1", from: "open", to: "in_progress" });
    const msg = lastMessage(ws);
    expect(msg.event).toBe("issue.status_changed");
    expect(msg.data).toEqual({ issue_id: "i1", from: "open", to: "in_progress" });
  });

  it("pr.status_changed broadcasts { pr_id, from, to }", () => {
    const ws = mockWs();
    addSubscriber("p1", ws);
    bus.emit("pr.status_changed", { pr_id: "pr1", project_id: "p1", from: "open", to: "merged" });
    const msg = lastMessage(ws);
    expect(msg.event).toBe("pr.status_changed");
    expect(msg.data).toEqual({ pr_id: "pr1", from: "open", to: "merged" });
  });

  it("mention.spawned broadcasts { issue_id, agent_id, pid }", () => {
    const ws = mockWs();
    addSubscriber("p1", ws);
    bus.emit("mention.spawned", { project_id: "p1", issue_id: "i1", agent_id: "a1", pid: 1234 });
    const msg = lastMessage(ws);
    expect(msg.event).toBe("mention.spawned");
    expect(msg.data).toEqual({ issue_id: "i1", agent_id: "a1", pid: 1234 });
  });

  it("mention.completed broadcasts { issue_id, agent_id, exit_code }", () => {
    const ws = mockWs();
    addSubscriber("p1", ws);
    bus.emit("mention.completed", { project_id: "p1", issue_id: "i1", agent_id: "a1", exit_code: 0 });
    const msg = lastMessage(ws);
    expect(msg.event).toBe("mention.completed");
    expect(msg.data).toEqual({ issue_id: "i1", agent_id: "a1", exit_code: 0 });
  });

  it("mention.error broadcasts { issue_id, agent_id, message }", () => {
    const ws = mockWs();
    addSubscriber("p1", ws);
    bus.emit("mention.error", { project_id: "p1", issue_id: "i1", agent_id: "a1", message: "boom" });
    const msg = lastMessage(ws);
    expect(msg.event).toBe("mention.error");
    expect(msg.data).toEqual({ issue_id: "i1", agent_id: "a1", message: "boom" });
  });
});
