import type { GlobalWsEventMap } from "./types.js";
import { wsBase } from "./ws.svelte.js";

export type GlobalWsEvent = keyof GlobalWsEventMap;

export interface GlobalWsMessage<E extends GlobalWsEvent = GlobalWsEvent> {
  event: E;
  data: GlobalWsEventMap[E];
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

export class GlobalWebSocket {
  #ws: WebSocket | null = null;
  #listeners = new Map<string, Set<Handler>>();
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectDelay = INITIAL_DELAY;
  #intentionalClose = false;

  state = $state<WsState>("disconnected");

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

  on<E extends GlobalWsEvent>(
    event: E,
    handler: (data: GlobalWsEventMap[E]) => void,
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
    const url = `${wsBase()}/ws?global=true`;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      this.state = "connected";
      this.#reconnectDelay = INITIAL_DELAY;
    };
    ws.onmessage = (e) => {
      try {
        const msg: GlobalWsMessage = JSON.parse(e.data);
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

  #dispatch(event: GlobalWsEvent, data: GlobalWsEventMap[GlobalWsEvent]) {
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
