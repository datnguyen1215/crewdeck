import { EventEmitter } from "events";
import { EventMap } from "./types.js";
import { logger } from "../logger.js";

type Handler<T> = (data: T) => void;

export class EventBus {
  private emitter = new EventEmitter();

  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    this.emitter.on(event as string, handler as Handler<unknown>);
  }

  off<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    this.emitter.off(event as string, handler as Handler<unknown>);
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    // Use rawListeners + manual loop so a throwing handler doesn't abort delivery
    // to subsequent handlers. emitter.emit() propagates the first uncaught error and stops.
    const listeners = this.emitter.rawListeners(event as string);
    for (const listener of listeners) {
      try {
        (listener as Handler<EventMap[K]>)(data);
      } catch (error) {
        logger.error({ event, error }, "Event handler failed");
      }
    }
  }

  // NOTE: We intentionally use composition (private emitter) rather than extending EventEmitter.
  // This keeps the public API strictly typed to EventMap and prevents callers from bypassing
  // the type constraints via inherited EventEmitter methods.
}

export const eventBus = new EventBus();
