import type { ActivityLog } from "$lib/api/http.js";
import type { WsEventMap } from "$lib/api/types.js";
import { parseUTC } from "$lib/utils/time.js";

export interface TerminalLine {
  id: string;
  timestamp: string;
  actor: string;
  actorType: "agent" | "system" | "user";
  message: string;
  issueId?: string;
  severity: "info" | "success" | "error" | "warning";
  raw?: unknown;
}

type Severity = TerminalLine["severity"];

/**
 * Format timestamp as HH:MM:SS in local time
 */
function formatTimestamp(dateStr: string): string {
  const date = parseUTC(dateStr);
  if (isNaN(date.getTime())) return "00:00:00";
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/**
 * Format actor string from type and optional name/id
 */
function formatActor(
  actorType: string,
  actorId?: string | null,
  actorName?: string | null,
): string {
  if (actorType === "agent") {
    const name = actorName || actorId || "unknown";
    return `agent:${name}`;
  }
  if (actorType === "system") return "system";
  return "user";
}

/**
 * Determine severity based on action and details
 */
function getSeverityForAction(
  action: string,
  details: Record<string, unknown>,
): Severity {
  // Error events
  if (action === "mention.error") return "error";

  // Status changes - check for warning states
  if (action === "issue.status_changed") {
    const to = String(details.to || "");
    if (to === "pr_conflict" || to === "pr_failed_actions") return "warning";
    return "info";
  }

  // Completion events - check exit code
  if (action === "mention.completed") {
    const exitCode = Number(details.exit_code ?? 1);
    return exitCode === 0 ? "success" : "error";
  }

  // Run completion - check status
  if (action === "run.completed") {
    const status = String(details.status || "");
    return status === "completed" ? "success" : "error";
  }

  // PR events
  if (action === "pr.created") return "success";
  if (action === "pr.status_changed") {
    const to = String(details.to || "");
    if (to === "merged") return "success";
    if (to === "closed") return "warning";
    return "info";
  }

  // Default to info
  return "info";
}

/**
 * Format activity log entry message
 */
function formatActivityMessage(
  action: string,
  details: Record<string, unknown>,
): string {
  switch (action) {
    case "issue.created":
      return "Created issue";

    case "issue.status_changed": {
      const from = String(details.from || "").replace(/_/g, " ");
      const to = String(details.to || "").replace(/_/g, " ");
      return `Status: ${from} → ${to}`;
    }

    case "comment.added": {
      const authorType = details.author_type || "unknown";
      return `Comment by ${authorType}`;
    }

    case "pr.created": {
      const prNumber = details.pr_number || "?";
      return `PR #${prNumber} created`;
    }

    case "pr.status_changed": {
      const prNumber = details.pr_number || "?";
      const from = String(details.from || "");
      const to = String(details.to || "");
      return `PR #${prNumber}: ${from} → ${to}`;
    }

    case "mention.spawned": {
      const issueId = String(details.issue_id || "");
      const shortId = issueId.slice(0, 8);
      return `Spawned on issue ${shortId}`;
    }

    case "mention.completed": {
      const exitCode = details.exit_code ?? "?";
      return `Completed (exit ${exitCode})`;
    }

    case "mention.error": {
      const message = String(details.message || "Unknown error");
      return message;
    }

    case "run.started":
      return "Run started";

    case "run.completed": {
      const status = String(details.status || "unknown");
      const cost = details.cost_usd
        ? `$${Number(details.cost_usd).toFixed(4)}`
        : "—";
      const duration = details.duration_ms
        ? `${(Number(details.duration_ms) / 1000).toFixed(1)}s`
        : "—";
      return `Run finished (${status}). Cost: ${cost}. Duration: ${duration}`;
    }

    default:
      // Generic fallback
      return action.replace(/_/g, " ");
  }
}

/**
 * Format an ActivityLog entry into a TerminalLine
 */
export function formatActivityEntry(entry: ActivityLog): TerminalLine {
  const details = (entry.details || {}) as Record<string, unknown>;
  const actorType = entry.actor_type as "agent" | "system" | "user";

  return {
    id: entry.id,
    timestamp: formatTimestamp(entry.created_at),
    actor: formatActor(entry.actor_type, entry.actor_id, entry.actor_name),
    actorType,
    message: formatActivityMessage(entry.action, details),
    issueId: entry.issue_id || undefined,
    severity: getSeverityForAction(entry.action, details),
    raw: entry,
  };
}

/**
 * Format a WebSocket event into a TerminalLine
 */
export function formatWsEvent(
  eventType: string,
  data: unknown,
): TerminalLine {
  const d = (data || {}) as Record<string, unknown>;
  const timestamp = String(d.timestamp || new Date().toISOString());
  const id = String(d.id || `ws-${Date.now()}-${Math.random()}`);

  // Determine actor and message based on event type
  let actor = "system";
  let actorType: "agent" | "system" | "user" = "system";
  let message = eventType.replace(/\./g, " ");
  let issueId: string | undefined;
  let severity: Severity = "info";

  switch (eventType) {
    case "issue.created":
      message = "Issue created";
      issueId = String((d.issue as any)?.id || "");
      break;

    case "issue.updated":
      message = "Issue updated";
      issueId = String(d.issue_id || "");
      break;

    case "issue.status_changed": {
      const from = String(d.from || "").replace(/_/g, " ");
      const to = String(d.to || "").replace(/_/g, " ");
      message = `Status: ${from} → ${to}`;
      issueId = String(d.issue_id || "");
      if (d.actor_type) {
        actorType = String(d.actor_type) as any;
        actor = formatActor(
          String(d.actor_type),
          String(d.actor_id || ""),
          undefined,
        );
      }
      if (to === "pr_conflict" || to === "pr_failed_actions")
        severity = "warning";
      break;
    }

    case "comment.added": {
      const comment = d.comment as any;
      const authorType = comment?.author_type || "unknown";
      message = `Comment by ${authorType}`;
      issueId = String(comment?.issue_id || "");
      break;
    }

    case "comment.updated":
      message = "Comment updated";
      issueId = String((d.comment as any)?.issue_id || "");
      break;

    case "comment.deleted":
      message = "Comment deleted";
      issueId = String(d.issue_id || "");
      break;

    case "pr.created": {
      const prNumber = (d.issue_pr as any)?.pr_number || "?";
      message = `PR #${prNumber} created`;
      issueId = String((d.issue_pr as any)?.issue_id || "");
      severity = "success";
      break;
    }

    case "pr.status_changed": {
      const from = String(d.from || "");
      const to = String(d.to || "");
      message = `PR: ${from} → ${to}`;
      if (to === "merged") severity = "success";
      if (to === "closed") severity = "warning";
      break;
    }

    case "mention.spawned": {
      const agentId = String(d.agent_id || "");
      const agentName = String(d.agent_name || agentId);
      actor = `agent:${agentName}`;
      actorType = "agent";
      issueId = String(d.issue_id || "");
      const shortId = issueId.slice(0, 8);
      message = `Spawned on issue ${shortId}`;
      severity = "info";
      break;
    }

    case "mention.completed": {
      const agentId = String(d.agent_id || "");
      const agentName = String(d.agent_name || agentId);
      actor = `agent:${agentName}`;
      actorType = "agent";
      issueId = String(d.issue_id || "");
      const exitCode = d.exit_code ?? "?";
      message = `Completed (exit ${exitCode})`;
      severity = Number(d.exit_code) === 0 ? "success" : "error";
      break;
    }

    case "mention.error": {
      const agentId = String(d.agent_id || "");
      const agentName = String(d.agent_name || agentId);
      actor = `agent:${agentName}`;
      actorType = "agent";
      issueId = String(d.issue_id || "");
      message = String(d.message || "Unknown error");
      severity = "error";
      break;
    }

    case "mention.chain_depth_reached": {
      message = "Chain depth limit reached";
      issueId = String(d.issue_id || "");
      severity = "warning";
      break;
    }

    case "dispatch.queued": {
      const agentId = String(d.agent_id || "");
      const position = d.position ?? "?";
      message = `Queued ${agentId} (position ${position})`;
      issueId = String(d.issue_id || "");
      break;
    }

    case "dispatch.dequeued": {
      const agentId = String(d.agent_id || "");
      message = `Dequeued ${agentId}`;
      issueId = String(d.issue_id || "");
      break;
    }

    case "run.started": {
      const agentId = String(d.agent_id || "");
      actor = `agent:${agentId}`;
      actorType = "agent";
      message = "Run started";
      issueId = String(d.issue_id || "");
      break;
    }

    case "run.event": {
      const eventType = String(d.type || "");
      message = `Event: ${eventType}`;
      issueId = String(d.issue_id || "");
      break;
    }

    case "run.completed": {
      const agentId = String(d.agent_id || "");
      actor = `agent:${agentId}`;
      actorType = "agent";
      const status = String(d.status || "unknown");
      const cost = d.cost_usd
        ? `$${Number(d.cost_usd).toFixed(4)}`
        : "—";
      const duration = d.duration_ms
        ? `${(Number(d.duration_ms) / 1000).toFixed(1)}s`
        : "—";
      message = `Run finished (${status}). Cost: ${cost}. Duration: ${duration}`;
      issueId = String(d.issue_id || "");
      severity = status === "completed" ? "success" : "error";
      break;
    }

    default:
      message = eventType.replace(/\./g, " ");
  }

  return {
    id,
    timestamp: formatTimestamp(timestamp),
    actor,
    actorType,
    message,
    issueId,
    severity,
    raw: data,
  };
}
