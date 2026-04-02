import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import type { EventBus } from "./events/bus.js";
import { getProject } from "./db/repositories/projects.js";
import { getIssue } from "./db/repositories/issues.js";
import { getCrewMember } from "./orchestration/crew.js";
import { logger } from "./logger.js";
import { validateSessionFromCookie } from "./middleware/auth.js";

const PING_INTERVAL = 30_000;
const PONG_TIMEOUT = 10_000;

const subscribers = new Map<string, Set<WebSocket>>();
const globalSubscribers = new Set<WebSocket>();

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function addSubscriber(projectId: string, ws: WebSocket): void {
  if (!subscribers.has(projectId)) subscribers.set(projectId, new Set());
  subscribers.get(projectId)!.add(ws);
}

function removeSubscriber(projectId: string, ws: WebSocket): void {
  const clients = subscribers.get(projectId);
  if (!clients) return;
  clients.delete(ws);
  if (clients.size === 0) subscribers.delete(projectId);
}

function addGlobalSubscriber(ws: WebSocket): void {
  globalSubscribers.add(ws);
}

function removeGlobalSubscriber(ws: WebSocket): void {
  globalSubscribers.delete(ws);
}

function broadcast(projectId: string, event: string, data: unknown): void {
  const clients = subscribers.get(projectId);
  if (!clients?.size) return;
  const message = JSON.stringify({
    event,
    data,
    timestamp: new Date().toISOString(),
  });
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

function broadcastGlobal(event: string, data: unknown): void {
  if (!globalSubscribers.size) return;
  const message = JSON.stringify({
    event,
    data,
    timestamp: new Date().toISOString(),
  });
  for (const ws of [...globalSubscribers]) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    try {
      ws.send(message);
    } catch (err) {
      logger.error({ err }, "Global WebSocket send failed");
      removeGlobalSubscriber(ws);
    }
  }
}

function subscribeEvents(bus: EventBus): void {
  bus.on("issue.created", ({ issue }) => {
    broadcast(issue.project_id, "issue.created", issue);
    broadcastGlobal("issue.created", issue);
  });

  bus.on("issue.updated", ({ issue_id, project_id, changes }) => {
    broadcast(project_id, "issue.updated", { issue_id, changes });
    broadcastGlobal("issue.updated", { issue_id, project_id, changes });
  });

  bus.on("issue.status_changed", ({ issue_id, project_id, from, to }) => {
    broadcast(project_id, "issue.status_changed", { issue_id, from, to });
    broadcastGlobal("issue.status_changed", { issue_id, project_id, from, to });
  });

  bus.on("issue.paused", ({ issue_id, project_id }) => {
    broadcast(project_id, "issue.paused", { issue_id });
    broadcastGlobal("issue.paused", { issue_id, project_id });
  });

  bus.on("issue.resumed", ({ issue_id, project_id }) => {
    broadcast(project_id, "issue.resumed", { issue_id });
    broadcastGlobal("issue.resumed", { issue_id, project_id });
  });

  bus.on("comment.added", ({ comment, project_id }) => {
    broadcast(project_id, "comment.added", comment);
    broadcastGlobal("comment.added", comment);
  });

  bus.on("comment.updated", ({ comment, project_id }) => {
    broadcast(project_id, "comment.updated", comment);
    broadcastGlobal("comment.updated", comment);
  });

  bus.on("comment.deleted", ({ comment_id, issue_id, project_id }) => {
    broadcast(project_id, "comment.deleted", { comment_id, issue_id });
    broadcastGlobal("comment.deleted", { comment_id, issue_id, project_id });
  });

  bus.on("pr.created", ({ issue_pr, project_id }) => {
    const issue = getIssue(issue_pr.issue_id);
    const enriched = { ...issue_pr, issue_title: issue?.title };
    broadcast(project_id, "pr.created", enriched);
    broadcastGlobal("pr.created", enriched);
  });

  bus.on("pr.status_changed", ({ pr_id, project_id, from, to }) => {
    broadcast(project_id, "pr.status_changed", { pr_id, from, to });
    broadcastGlobal("pr.status_changed", { pr_id, project_id, from, to });
  });

  bus.on("mention.spawned", ({ project_id, issue_id, agent_id, pid }) => {
    const agent = getCrewMember(agent_id);
    const issue = getIssue(issue_id);
    const payload = {
      project_id,
      issue_id,
      agent_id,
      agent_name: agent?.name,
      issue_title: issue?.title,
      pid,
    };
    broadcast(project_id, "mention.spawned", payload);
    broadcastGlobal("mention.spawned", payload);
  });

  bus.on(
    "mention.completed",
    ({ project_id, issue_id, agent_id, exit_code }) => {
      const agent = getCrewMember(agent_id);
      const issue = issue_id ? getIssue(issue_id) : null;
      const payload = {
        project_id,
        issue_id,
        agent_id,
        agent_name: agent?.name,
        issue_title: issue?.title,
        exit_code,
      };
      broadcast(project_id, "mention.completed", payload);
      broadcastGlobal("mention.completed", payload);
    },
  );

  bus.on("mention.error", ({ project_id, issue_id, agent_id, message }) => {
    const agent = getCrewMember(agent_id);
    const issue = getIssue(issue_id);
    const payload = {
      project_id,
      issue_id,
      agent_id,
      agent_name: agent?.name,
      issue_title: issue?.title,
      message,
    };
    broadcast(project_id, "mention.error", payload);
    broadcastGlobal("mention.error", payload);
  });

  bus.on("mention.chain_depth_reached", ({ project_id, issue_id }) => {
    const issue = getIssue(issue_id);
    const payload = { project_id, issue_id, issue_title: issue?.title };
    broadcast(project_id, "mention.chain_depth_reached", payload);
    broadcastGlobal("mention.chain_depth_reached", payload);
  });

  bus.on("dispatch.queued", ({ project_id, issue_id, agent_id, position }) => {
    const agent = getCrewMember(agent_id);
    const issue = getIssue(issue_id);
    const payload = {
      project_id,
      issue_id,
      agent_id,
      agent_name: agent?.name,
      issue_title: issue?.title,
      position,
    };
    broadcast(project_id, "dispatch.queued", payload);
    broadcastGlobal("dispatch.queued", payload);
  });

  bus.on("dispatch.dequeued", ({ project_id, issue_id, agent_id }) => {
    const agent = getCrewMember(agent_id);
    const issue = getIssue(issue_id);
    const payload = {
      project_id,
      issue_id,
      agent_id,
      agent_name: agent?.name,
      issue_title: issue?.title,
    };
    broadcast(project_id, "dispatch.dequeued", payload);
    broadcastGlobal("dispatch.dequeued", payload);
  });

  bus.on("run.started", ({ project_id, ...data }) => {
    broadcast(project_id, "run.started", data);
    broadcastGlobal("run.started", { project_id, ...data });
  });

  bus.on("run.event", ({ project_id, ...data }) =>
    broadcast(project_id, "run.event", data),
  );

  bus.on("run.completed", ({ project_id, ...data }) => {
    broadcast(project_id, "run.completed", data);
    broadcastGlobal("run.completed", { project_id, ...data });
  });

  // Project settings changed
  bus.on("project.settings_changed", ({ project_id, changes }) => {
    broadcast(project_id, "project.settings_changed", { changes });
    broadcastGlobal("project.settings_changed", { project_id, changes });
  });

  // Monitor events (captain orchestration)
  bus.on("monitor.event_received", (data) => {
    broadcast(data.project_id, "monitor.event_received", data);
  });
  bus.on("monitor.thinking", (data) => {
    broadcast(data.project_id, "monitor.thinking", data);
  });
  bus.on("monitor.message", (data) => {
    broadcast(data.project_id, "monitor.message", data);
  });
  bus.on("monitor.tool_call", (data) => {
    broadcast(data.project_id, "monitor.tool_call", data);
  });
  bus.on("monitor.tool_result", (data) => {
    broadcast(data.project_id, "monitor.tool_result", data);
  });
  bus.on("monitor.complete", (data) => {
    broadcast(data.project_id, "monitor.complete", data);
  });
}

interface ExtendedWebSocket extends WebSocket {
  isAlive?: boolean;
  pongTimeout?: ReturnType<typeof setTimeout>;
}

export function setupWebSocket(server: Server, bus: EventBus): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

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
    for (const ws of [...globalSubscribers] as ExtendedWebSocket[]) {
      if (!ws.isAlive) {
        ws.terminate();
        removeGlobalSubscriber(ws);
        continue;
      }
      ws.isAlive = false;
      ws.pongTimeout = setTimeout(() => {
        ws.terminate();
        removeGlobalSubscriber(ws);
      }, PONG_TIMEOUT);
      ws.ping();
    }
  }, PING_INTERVAL);

  wss.on("connection", (socket, req: IncomingMessage) => {
    const ws = socket as ExtendedWebSocket;
    try {
      const session = validateSessionFromCookie(req.headers.cookie);
      if (!session) {
        ws.close(4001, "Unauthorized");
        return;
      }

      const url = new URL(req.url ?? "", "http://localhost");
      const isGlobal = url.searchParams.get("global") === "true";

      if (isGlobal) {
        ws.isAlive = true;
        addGlobalSubscriber(ws);

        ws.on("pong", () => {
          ws.isAlive = true;
          if (ws.pongTimeout) clearTimeout(ws.pongTimeout);
        });

        ws.on("close", () => {
          if (ws.pongTimeout) clearTimeout(ws.pongTimeout);
          removeGlobalSubscriber(ws);
        });

        ws.on("error", (err) => {
          logger.error({ err }, "Global WebSocket error");
          if (ws.pongTimeout) clearTimeout(ws.pongTimeout);
          removeGlobalSubscriber(ws);
        });
      } else {
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

        ws.isAlive = true;
        addSubscriber(projectId, ws);

        ws.on("pong", () => {
          ws.isAlive = true;
          if (ws.pongTimeout) clearTimeout(ws.pongTimeout);
        });

        ws.on("close", () => {
          if (ws.pongTimeout) clearTimeout(ws.pongTimeout);
          removeSubscriber(projectId, ws);
        });

        ws.on("error", (err) => {
          logger.error({ err }, "WebSocket error");
          if (ws.pongTimeout) clearTimeout(ws.pongTimeout);
          removeSubscriber(projectId, ws);
        });
      }
    } catch (err) {
      logger.error({ err }, "WebSocket connection setup failed");
      ws.close(4011, "Internal error");
    }
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
    for (const ws of clients) ws.close(1001, "Going Away");
  }
  subscribers.clear();
  for (const ws of globalSubscribers) ws.close(1001, "Going Away");
  globalSubscribers.clear();
  wss.close();
}
