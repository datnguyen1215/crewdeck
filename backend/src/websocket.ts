import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import type { EventBus } from "./events/bus.js";
import { getProject } from "./db/repositories/projects.js";
import { logger } from "./logger.js";

const PING_INTERVAL = 30_000;
const PONG_TIMEOUT = 10_000;

// projectId → connected clients
export const subscribers = new Map<string, Set<WebSocket>>();

// sessionId → output buffer for debouncing session.output
const outputBuffers = new Map<string, { chunks: string[]; timer: ReturnType<typeof setTimeout> | null }>();

// Interval handle so we can clear it on shutdown
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

export function addSubscriber(projectId: string, ws: WebSocket): void {
  if (!subscribers.has(projectId)) subscribers.set(projectId, new Set());
  subscribers.get(projectId)!.add(ws);
}

export function removeSubscriber(projectId: string, ws: WebSocket): void {
  const clients = subscribers.get(projectId);
  if (!clients) return;
  clients.delete(ws);
  if (clients.size === 0) subscribers.delete(projectId);
}

export function broadcast(projectId: string, event: string, data: unknown): void {
  const clients = subscribers.get(projectId);
  if (!clients?.size) return;
  const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  for (const ws of [...clients]) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    try {
      ws.send(message);
    } catch (err) {
      logger.error({ err }, "WebSocket send failed");
      removeSubscriber(projectId, ws);
    }
  }
}

function flushSessionOutput(sessionId: string, projectId: string): void {
  const buf = outputBuffers.get(sessionId);
  if (!buf || buf.chunks.length === 0) return;
  const output = buf.chunks.join("");
  buf.chunks = [];
  buf.timer = null;
  broadcast(projectId, "session.output", { session_id: sessionId, output });
}

export function subscribeEvents(bus: EventBus): void {
  bus.on("issue.created", ({ issue }) =>
    broadcast(issue.project_id, "issue.created", issue));

  bus.on("issue.updated", ({ issue_id, project_id, changes }) =>
    broadcast(project_id, "issue.updated", { issue_id, changes }));

  bus.on("issue.approved", ({ issue }) =>
    broadcast(issue.project_id, "issue.approved", issue));

  bus.on("issue.status_changed", ({ issue_id, project_id, from, to }) =>
    broadcast(project_id, "issue.status_changed", { issue_id, from, to }));

  bus.on("issue.assigned", ({ issue_id, project_id, agent_id, agent_name }) =>
    broadcast(project_id, "issue.assigned", { issue_id, agent_id, agent_name }));

  bus.on("comment.added", ({ comment, project_id }) =>
    broadcast(project_id, "comment.added", comment));

  bus.on("session.started", ({ session_id, agent_id, issue_id, project_id, tmux_session_name }) =>
    broadcast(project_id, "session.started", { session_id, agent_id, issue_id, tmux_session_name }));

  bus.on("session.output", ({ session_id, project_id, output }) => {
    let buf = outputBuffers.get(session_id);
    if (!buf) {
      buf = { chunks: [], timer: null };
      outputBuffers.set(session_id, buf);
    }
    buf.chunks.push(output);
    if (!buf.timer) {
      buf.timer = setTimeout(() => flushSessionOutput(session_id, project_id), 100);
    }
  });

  bus.on("session.ended", ({ session_id, project_id, status }) => {
    // Flush any buffered output before the ended event
    const buf = outputBuffers.get(session_id);
    if (buf?.timer) {
      clearTimeout(buf.timer);
      buf.timer = null;
    }
    flushSessionOutput(session_id, project_id);
    outputBuffers.delete(session_id);
    broadcast(project_id, "session.ended", { session_id, status });
  });

  bus.on("agent.working", ({ agent_id, issue_id, project_id, session_id }) =>
    broadcast(project_id, "agent.working", { agent_id, issue_id, session_id }));

  bus.on("agent.idle", ({ agent_id, project_id }) =>
    broadcast(project_id, "agent.idle", { agent_id }));

  bus.on("pr.created", ({ issue_pr, project_id }) =>
    broadcast(project_id, "pr.created", issue_pr));

  bus.on("pr.status_changed", ({ pr_id, project_id, from, to }) =>
    broadcast(project_id, "pr.status_changed", { pr_id, from, to }));

  bus.on("orchestrator.decision", ({ project_id, action, details }) =>
    broadcast(project_id, "orchestrator.decision", { action, details }));

  bus.on("orchestrator.draft_issue", ({ issue, project_id }) =>
    broadcast(project_id, "orchestrator.draft_issue", issue));
}

interface ExtendedWebSocket extends WebSocket {
  isAlive?: boolean;
  pongTimeout?: ReturnType<typeof setTimeout>;
}

export function setupWebSocket(server: Server, bus: EventBus): WebSocketServer {
  // TODO: add per-IP connection cap
  const wss = new WebSocketServer({ server, path: "/ws" });

  heartbeatInterval = setInterval(() => {
    for (const [projectId, clients] of subscribers) {
      for (const ws of [...clients] as ExtendedWebSocket[]) {
        if (!ws.isAlive) {
          ws.terminate();
          removeSubscriber(projectId, ws);
          continue;
        }
        ws.isAlive = false;
        ws.pongTimeout = setTimeout(() => {
          ws.terminate();
          removeSubscriber(projectId, ws);
        }, PONG_TIMEOUT);
        ws.ping();
      }
    }
  }, PING_INTERVAL);

  wss.on("connection", (socket, req: IncomingMessage) => {
    const ws = socket as ExtendedWebSocket;
    const url = new URL(req.url ?? "", "http://localhost");
    const projectId = url.searchParams.get("projectId");

    if (!projectId) {
      ws.close(4004, "Missing projectId");
      return;
    }

    const project = getProject(projectId);
    if (!project) {
      ws.close(4004, "Project not found");
      return;
    }

    // TODO: authenticate WebSocket connections (same as REST auth middleware)
    ws.isAlive = true;
    addSubscriber(projectId, ws);

    ws.on("pong", () => {
      ws.isAlive = true;
      if (ws.pongTimeout) clearTimeout(ws.pongTimeout);
    });

    // Server-push only — client messages are ignored
    ws.on("close", () => removeSubscriber(projectId, ws));

    ws.on("error", (err) => {
      logger.error({ err }, "WebSocket error");
      removeSubscriber(projectId, ws);
    });
  });

  subscribeEvents(bus);

  return wss;
}

export function shutdownWebSocket(wss: WebSocketServer): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  for (const [, clients] of subscribers) {
    for (const ws of clients) {
      ws.close(1001, "Going Away");
    }
  }
  subscribers.clear();
  outputBuffers.clear();
  wss.close();
}
