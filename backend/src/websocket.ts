import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import type { EventBus } from "./events/bus.js";
import { getProject } from "./db/repositories/projects.js";
import { getIssue } from "./db/repositories/issues.js";
import { getCrewMember } from "./orchestration/crew.js";
import { logger } from "./logger.js";
import { getSessionFromCookie, type Session } from "./middleware/auth.js";
import { config } from "./config.js";

const PING_INTERVAL = 30_000;
const PONG_TIMEOUT = 10_000;

const subscribers = new Map<string, Set<WebSocket>>();

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

function broadcast(projectId: string, event: string, data: unknown): void {
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

function subscribeEvents(bus: EventBus): void {
  bus.on("issue.created", ({ issue }) =>
    broadcast(issue.project_id, "issue.created", issue),
  );

  bus.on("issue.updated", ({ issue_id, project_id, changes }) =>
    broadcast(project_id, "issue.updated", { issue_id, changes }),
  );

  bus.on("issue.status_changed", ({ issue_id, project_id, from, to }) =>
    broadcast(project_id, "issue.status_changed", { issue_id, from, to }),
  );

  bus.on("comment.added", ({ comment, project_id }) =>
    broadcast(project_id, "comment.added", comment),
  );

  bus.on("comment.updated", ({ comment, project_id }) =>
    broadcast(project_id, "comment.updated", comment),
  );

  bus.on("comment.deleted", ({ comment_id, issue_id, project_id }) =>
    broadcast(project_id, "comment.deleted", { comment_id, issue_id }),
  );

  bus.on("pr.created", ({ issue_pr, project_id }) => {
    const issue = getIssue(issue_pr.issue_id);
    broadcast(project_id, "pr.created", {
      ...issue_pr,
      issue_title: issue?.title,
    });
  });

  bus.on("pr.status_changed", ({ pr_id, project_id, from, to }) =>
    broadcast(project_id, "pr.status_changed", { pr_id, from, to }),
  );

  bus.on("mention.spawned", ({ project_id, issue_id, agent_id, pid }) => {
    const agent = getCrewMember(agent_id);
    const issue = getIssue(issue_id);
    broadcast(project_id, "mention.spawned", {
      issue_id,
      agent_id,
      agent_name: agent?.name,
      issue_title: issue?.title,
      pid,
    });
  });

  bus.on("mention.completed", ({ project_id, issue_id, agent_id, exit_code }) => {
    const agent = getCrewMember(agent_id);
    const issue = issue_id ? getIssue(issue_id) : null;
    broadcast(project_id, "mention.completed", {
      issue_id,
      agent_id,
      agent_name: agent?.name,
      issue_title: issue?.title,
      exit_code,
    });
  });

  bus.on("mention.error", ({ project_id, issue_id, agent_id, message }) => {
    const agent = getCrewMember(agent_id);
    const issue = getIssue(issue_id);
    broadcast(project_id, "mention.error", {
      issue_id,
      agent_id,
      agent_name: agent?.name,
      issue_title: issue?.title,
      message,
    });
  });

  bus.on("mention.chain_depth_reached", ({ project_id, issue_id }) => {
    const issue = getIssue(issue_id);
    broadcast(project_id, "mention.chain_depth_reached", {
      issue_id,
      issue_title: issue?.title,
    });
  });

  bus.on("dispatch.queued", ({ project_id, issue_id, agent_id, position }) => {
    const agent = getCrewMember(agent_id);
    const issue = getIssue(issue_id);
    broadcast(project_id, "dispatch.queued", {
      issue_id,
      agent_id,
      agent_name: agent?.name,
      issue_title: issue?.title,
      position,
    });
  });

  bus.on("dispatch.dequeued", ({ project_id, issue_id, agent_id }) => {
    const agent = getCrewMember(agent_id);
    const issue = getIssue(issue_id);
    broadcast(project_id, "dispatch.dequeued", {
      issue_id,
      agent_id,
      agent_name: agent?.name,
      issue_title: issue?.title,
    });
  });

  bus.on("run.started", ({ project_id, ...data }) =>
    broadcast(project_id, "run.started", data),
  );

  bus.on("run.event", ({ project_id, ...data }) =>
    broadcast(project_id, "run.event", data),
  );

  bus.on("run.completed", ({ project_id, ...data }) =>
    broadcast(project_id, "run.completed", data),
  );

  // Admiral chat events
  bus.on("chat.stream", ({ project_id, token }) =>
    broadcast(project_id, "chat.stream", { token }),
  );

  bus.on("chat.complete", ({ project_id, message_id }) =>
    broadcast(project_id, "chat.complete", { message_id }),
  );

  // Admiral terminal events
  bus.on("admiral.event_received", ({ project_id, event_type, description }) =>
    broadcast(project_id, "admiral.event_received", { event_type, description }),
  );

  bus.on("admiral.thinking", ({ project_id }) =>
    broadcast(project_id, "admiral.thinking", {}),
  );

  bus.on("admiral.message", ({ project_id, content }) =>
    broadcast(project_id, "admiral.message", { content }),
  );

  bus.on("admiral.tool_call", ({ project_id, tool_name, tool_input }) =>
    broadcast(project_id, "admiral.tool_call", { tool_name, tool_input }),
  );

  bus.on("admiral.tool_result", ({ project_id, tool_name, result }) =>
    broadcast(project_id, "admiral.tool_result", { tool_name, result }),
  );

  bus.on("admiral.complete", ({ project_id }) =>
    broadcast(project_id, "admiral.complete", {}),
  );
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
  }, PING_INTERVAL);

  wss.on("connection", (socket, req: IncomingMessage) => {
    const ws = socket as ExtendedWebSocket;
    try {
      // Validate session from cookie (skip in test/dev if no Google OAuth configured)
      if (config.googleClientId) {
        const session = getSessionFromCookie(req);
        if (!session) {
          ws.close(4001, "Unauthorized");
          return;
        }
      }

      const url = new URL(req.url ?? "", "http://localhost");
      const projectId = url.searchParams.get("projectId");
      if (!projectId) { ws.close(4004, "Missing projectId"); return; }
      const project = getProject(projectId);
      if (!project) { ws.close(4004, "Project not found"); return; }

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
  wss.close();
}
