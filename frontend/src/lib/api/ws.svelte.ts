function wsBase(): string {
  const backendUrl: string =
    import.meta.env.VITE_BACKEND_URL ||
    (import.meta.env.DEV ? "http://localhost:9381" : "");
  if (backendUrl) return backendUrl.replace(/^http/, "ws");
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}`;
}

export type WsEvent =
  | "issue.created"
  | "issue.updated"
  | "issue.status_changed"
  | "comment.added"
  | "comment.updated"
  | "comment.deleted"
  | "pr.created"
  | "pr.status_changed"
  | "mention.spawned"
  | "mention.completed"
  | "mention.error"
  | "mention.chain_depth_reached";

export interface WsMessage {
  event: WsEvent;
  data: Record<string, unknown>;
  timestamp: string;
}

type Handler = (data: Record<string, unknown>) => void;

export type WsState = "connecting" | "connected" | "disconnected" | "reconnecting";

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
    if (this.#ws) { this.#ws.close(); this.#ws = null; }
    this.state = "disconnected";
  }

  on(event: WsEvent | "*", handler: Handler) {
    let set = this.#listeners.get(event);
    if (!set) { set = new Set(); this.#listeners.set(event, set); }
    set.add(handler);
    return () => { this.#listeners.get(event)?.delete(handler); };
  }

  #open() {
    this.state = this.#reconnectDelay > INITIAL_DELAY ? "reconnecting" : "connecting";
    const url = `${wsBase()}/ws?projectId=${encodeURIComponent(this.#projectId)}`;
    const ws = new WebSocket(url);

    ws.onopen = () => { this.state = "connected"; this.#reconnectDelay = INITIAL_DELAY; };
    ws.onmessage = (e) => {
      try { const msg: WsMessage = JSON.parse(e.data); this.#dispatch(msg.event, msg.data); } catch {}
    };
    ws.onclose = () => {
      this.#ws = null;
      if (!this.#intentionalClose) { this.state = "reconnecting"; this.#scheduleReconnect(); }
    };
    ws.onerror = () => {};
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
    if (this.#reconnectTimer) { clearTimeout(this.#reconnectTimer); this.#reconnectTimer = null; }
  }
}
