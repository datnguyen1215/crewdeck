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
    const listeners = this.emitter.rawListeners(event as string);
    for (const listener of listeners) {
      try {
        (listener as Handler<EventMap[K]>)(data);
      } catch (error) {
        logger.error({ event, error }, "Event handler failed");
      }
    }
  }
}

export const eventBus = new EventBus();
