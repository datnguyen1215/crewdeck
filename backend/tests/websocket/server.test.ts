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
    bus.on("issue.created", ({ issue }) => broadcast(issue.project_id, "issue.created", issue));
    bus.emit("issue.created", { issue: { id: "i1", project_id: "p1" } as never });
    const msg = lastMessage(ws);
    expect(msg.event).toBe("issue.created");
    expect((msg.data as Record<string, unknown>).id).toBe("i1");
  });

  it("issue.status_changed broadcasts { issue_id, from, to }", () => {
    const ws = mockWs();
    addSubscriber("p1", ws);
    bus.on("issue.status_changed", ({ issue_id, project_id, from, to }) =>
      broadcast(project_id, "issue.status_changed", { issue_id, from, to }));
    bus.emit("issue.status_changed", { issue_id: "i1", project_id: "p1", from: "open", to: "closed" });
    const msg = lastMessage(ws);
    expect(msg.event).toBe("issue.status_changed");
    expect(msg.data).toEqual({ issue_id: "i1", from: "open", to: "closed" });
  });

  it("agent.idle broadcasts { agent_id }", () => {
    const ws = mockWs();
    addSubscriber("p1", ws);
    bus.on("agent.idle", ({ agent_id, project_id }) =>
      broadcast(project_id, "agent.idle", { agent_id }));
    bus.emit("agent.idle", { agent_id: "a1", project_id: "p1" });
    const msg = lastMessage(ws);
    expect(msg.event).toBe("agent.idle");
    expect(msg.data).toEqual({ agent_id: "a1" });
  });

  it("pr.status_changed broadcasts { pr_id, from, to }", () => {
    const ws = mockWs();
    addSubscriber("p1", ws);
    bus.on("pr.status_changed", ({ pr_id, project_id, from, to }) =>
      broadcast(project_id, "pr.status_changed", { pr_id, from, to }));
    bus.emit("pr.status_changed", { pr_id: "pr1", project_id: "p1", from: "open", to: "merged" });
    const msg = lastMessage(ws);
    expect(msg.event).toBe("pr.status_changed");
    expect(msg.data).toEqual({ pr_id: "pr1", from: "open", to: "merged" });
  });
});

describe("session.output debouncing", () => {
  let bus: EventBus;

  beforeEach(() => {
    vi.useFakeTimers();
    subscribers.clear();
    bus = new EventBus();
    subscribeEvents(bus);
  });

  afterEach(() => {
    vi.useRealTimers();
    subscribers.clear();
  });

  it("buffers multiple chunks and sends them together within 100ms", () => {
    const ws = mockWs();
    addSubscriber("p1", ws);

    bus.emit("session.output", { session_id: "s1", project_id: "p1", output: "hello " });
    bus.emit("session.output", { session_id: "s1", project_id: "p1", output: "world" });

    // Not sent yet
    expect((ws.send as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect((ws.send as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    const msg = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(msg.event).toBe("session.output");
    expect((msg.data as Record<string, unknown>).output).toBe("hello world");
  });

  it("sends at most once per 100ms even with many rapid chunks", () => {
    const ws = mockWs();
    addSubscriber("p1", ws);

    for (let i = 0; i < 20; i++) {
      bus.emit("session.output", { session_id: "s2", project_id: "p1", output: `chunk${i}` });
    }

    vi.advanceTimersByTime(100);
    expect((ws.send as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });
});
