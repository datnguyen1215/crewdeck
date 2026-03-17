import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import http from "http";
import express from "express";
import { WebSocket as WsClient } from "ws";
import { EventBus } from "../../src/events/bus.js";
import { setupWebSocket, shutdownWebSocket, subscribers } from "../../src/websocket.js";
import { createProject } from "../../src/db/repositories/projects.js";

// Creates a server on a random free port and returns it with a cleanup handle
async function startServer(bus: EventBus): Promise<{
  server: http.Server;
  wss: import("ws").WebSocketServer;
  port: number;
}> {
  const app = express();
  const server = http.createServer(app);
  const wss = setupWebSocket(server, bus);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return { server, wss, port };
}

function connectWs(port: number, projectId: string): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const ws = new WsClient(`ws://127.0.0.1:${port}/ws?projectId=${projectId}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function waitForMessage(ws: WsClient): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
  });
}

function waitForClose(ws: WsClient): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

describe("WebSocket integration", () => {
  let bus: EventBus;
  let port: number;
  let wss: import("ws").WebSocketServer;
  let server: http.Server;
  let projectId: string;

  beforeAll(async () => {
    bus = new EventBus();
    ({ server, wss, port } = await startServer(bus));
    const project = createProject({ name: "ws-test-project" });
    projectId = project.id;
  });

  afterAll(() => {
    shutdownWebSocket(wss);
    server.close();
  });

  afterEach(() => {
    subscribers.clear();
  });

  it("client connects with valid projectId and receives events", async () => {
    const ws = await connectWs(port, projectId);
    const msgPromise = waitForMessage(ws);

    bus.emit("issue.created", {
      issue: { id: "i1", project_id: projectId } as never,
    });

    const msg = await msgPromise;
    expect(msg.event).toBe("issue.created");
    expect((msg.data as Record<string, unknown>).id).toBe("i1");
    expect(typeof msg.timestamp).toBe("string");
    ws.close();
  });

  it("client with invalid projectId is rejected with code 4004", async () => {
    const ws = new WsClient(`ws://127.0.0.1:${port}/ws?projectId=nonexistent-id`);
    const { code } = await waitForClose(ws);
    expect(code).toBe(4004);
  });

  it("client without projectId is rejected with code 4004", async () => {
    const ws = new WsClient(`ws://127.0.0.1:${port}/ws`);
    const { code } = await waitForClose(ws);
    expect(code).toBe(4004);
  });

  it("event is only delivered to clients subscribed to the matching project", async () => {
    const otherProject = createProject({ name: "other-project" });
    const ws1 = await connectWs(port, projectId);
    const ws2 = await connectWs(port, otherProject.id);

    const msgPromise = waitForMessage(ws1);
    let ws2Received = false;
    ws2.on("message", () => { ws2Received = true; });

    bus.emit("agent.status_changed", { agent_id: "a1", issue_id: "i1", project_id: projectId, state: "active" });

    const msg = await msgPromise;
    expect(msg.event).toBe("agent.status_changed");

    // Give ws2 a moment to receive — it should not
    await new Promise((r) => setTimeout(r, 50));
    expect(ws2Received).toBe(false);

    ws1.close();
    ws2.close();
  });

  it("disconnected client is removed from subscriber set", async () => {
    const ws = await connectWs(port, projectId);
    // Wait for it to be registered
    await new Promise((r) => setTimeout(r, 20));
    expect(subscribers.get(projectId)?.size).toBeGreaterThan(0);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
    // Should be removed (or set empty)
    expect(subscribers.get(projectId)?.size ?? 0).toBe(0);
  });

});
