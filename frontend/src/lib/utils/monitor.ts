import type { MonitorMessage, MonitorEntry } from "$lib/api/types.js";

export function mapMessageToEntry(msg: MonitorMessage): MonitorEntry {
  return {
    id: msg.id,
    type: msg.role === "user" ? "event" : "message",
    content: msg.content,
    timestamp: new Date(msg.created_at),
  };
}
