import type { ProjectWebSocket, WsEvent } from "$lib/api/ws.svelte.js";
import type { WsEventMap } from "$lib/api/types.js";

type SubscriptionMap = {
  [E in WsEvent]?: (data: WsEventMap[E]) => void;
};

/**
 * Subscribes to multiple WebSocket events and returns a single cleanup function.
 * Designed to be called inside a $effect — return the cleanup function directly.
 */
export function useWsSubscriptions(
  ws: ProjectWebSocket,
  subscriptions: SubscriptionMap,
): () => void {
  const unsubs = (
    Object.entries(subscriptions) as [WsEvent, (data: any) => void][]
  ).map(([event, handler]) => ws.on(event, handler));
  return () => unsubs.forEach((fn) => fn());
}
