import type { WsEventMap } from "./types.js";

export function wsBase(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}`;
}

export type WsEvent = keyof WsEventMap;

export interface WsMessage<E extends WsEvent = WsEvent> {
  event: E;
  data: WsEventMap[E];
  timestamp: string;
}

type Handler = (data: any) => void;

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

  on<E extends WsEvent>(
    event: E,
    handler: (data: WsEventMap[E]) => void,
  ): () => void;
  on(event: "*", handler: (data: Record<string, unknown>) => void): () => void;
  on(event: string, handler: Handler) {
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
      } catch {}
    };
    ws.onclose = () => {
      this.#ws = null;
      if (!this.#intentionalClose) {
        this.state = "reconnecting";
        this.#scheduleReconnect();
      }
    };
    ws.onerror = () => {};
    this.#ws = ws;
  }

  #dispatch(event: WsEvent, data: WsEventMap[WsEvent]) {
    this.#listeners.get(event)?.forEach((h) => h(data));
    this.#listeners
      .get("*")
      ?.forEach((h) =>
        h({ ...(data as Record<string, unknown>), _event: event }),
      );
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
