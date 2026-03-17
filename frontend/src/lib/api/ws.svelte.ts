/**
 * WebSocket client for real-time project events.
 * Connects to /ws?projectId=<id>, auto-reconnects with exponential backoff.
 * Push-only — the server ignores client messages.
 */

/** Returns the WebSocket base URL pointing at the backend.
 *  In dev, connects directly to the backend to avoid Vite proxy issues.
 *  In production, uses the same origin (backend serves both HTTP and WS). */
function wsBase(): string {
  const backendUrl: string = import.meta.env.VITE_BACKEND_URL || "";
  if (backendUrl) {
    return backendUrl.replace(/^http/, "ws");
  }
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}`;
}

export type WsEvent =
  | "issue.created"
  | "issue.updated"
  | "issue.approved"
  | "issue.status_changed"
  | "issue.assigned"
  | "comment.added"
  | "comment.updated"
  | "comment.deleted"
  | "session.started"
  | "session.ended"
  | "agent.finished"
  | "agent.status_changed"
  | "agent.error"
  | "agent.needs_help"
  | "review.completed"
  | "pr.created"
  | "pr.status_changed"
  | "orchestrator.decision"
  | "orchestrator.draft_issue"
  | "captain.message";

export interface WsMessage {
  event: WsEvent;
  data: Record<string, unknown>;
  timestamp: string;
}

type Handler = (data: Record<string, unknown>) => void;

export type WsState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting";

const INITIAL_DELAY = 1000;
const MAX_DELAY = 30000;

export class ProjectWebSocket {
  #ws: WebSocket | null = null;
  #projectId: string;
  #listeners = new Map<string, Set<Handler>>();
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectDelay = INITIAL_DELAY;
  #intentionalClose = false;

  state = $state<WsState>("disconnected");

  constructor(projectId: string) {
    this.#projectId = projectId;
  }

  connect() {
    if (this.#ws) return;
    this.#intentionalClose = false;
    this.#open();
  }

  disconnect() {
    this.#intentionalClose = true;
    this.#clearReconnect();
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
    this.state = "disconnected";
  }

  on(event: WsEvent | "*", handler: Handler) {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(handler);
    return () => {
      this.#listeners.get(event)?.delete(handler);
    };
  }

  #open() {
    this.state =
      this.#reconnectDelay > INITIAL_DELAY ? "reconnecting" : "connecting";

    const url = `${wsBase()}/ws?projectId=${encodeURIComponent(this.#projectId)}`;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      this.state = "connected";
      this.#reconnectDelay = INITIAL_DELAY;
    };

    ws.onmessage = (e) => {
      try {
        const msg: WsMessage = JSON.parse(e.data);
        this.#dispatch(msg.event, msg.data);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      this.#ws = null;
      if (!this.#intentionalClose) {
        this.state = "reconnecting";
        this.#scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror, which handles reconnection
    };

    this.#ws = ws;
  }

  #dispatch(event: WsEvent, data: Record<string, unknown>) {
    this.#listeners.get(event)?.forEach((h) => h(data));
    this.#listeners.get("*")?.forEach((h) => h({ ...data, _event: event }));
  }

  #scheduleReconnect() {
    this.#clearReconnect();
    this.#reconnectTimer = setTimeout(() => {
      this.#open();
      this.#reconnectDelay = Math.min(this.#reconnectDelay * 2, MAX_DELAY);
    }, this.#reconnectDelay);
  }

  #clearReconnect() {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }
}
