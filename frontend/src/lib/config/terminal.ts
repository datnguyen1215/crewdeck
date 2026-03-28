import type { ActivityLog } from "$lib/api/http.js";
import { parseUTC } from "$lib/utils/time.js";

export interface TerminalLine {
  id: string;
  timestamp: string;
  actor: string;
  actorType: "agent" | "system" | "user";
  message: string;
  issueId?: string;
  issueTitle?: string;
  severity: "info" | "success" | "error" | "warning" | "started";
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
    if (to === "done") return "success";
    if (to === "discarded") return "error";
    // All other status changes default to warning (amber) for visibility
    return "warning";
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
  if (action === "pr.created") return "started";
  if (action === "pr.status_changed") {
    const to = String(details.to || "");
    if (to === "merged") return "success";
    if (to === "closed") return "warning";
    return "info";
  }

  // Started events
  if (action === "mention.spawned" || action === "run.started")
    return "started";

  // Default to info
  return "info";
}

/**
 * Capitalize the first letter of a string
 */
function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Humanize an exit code number into a descriptive string
 */
function humanizeExitCode(exitCode: unknown): string {
  const code = Number(exitCode);
  if (exitCode === null || exitCode === undefined || exitCode === "?")
    return "exit ?";
  if (code === 0) return "success";
  if (code === 1) return "error (exit 1)";
  if (code === 2) return "misuse (exit 2)";
  if (code === 130) return "interrupted (exit 130)";
  if (code === 143) return "terminated (exit 143)";
  return `exit ${code}`;
}

/**
 * Format activity log entry message
 */
function formatActivityMessage(
  action: string,
  details: Record<string, unknown>,
  actorName?: string | null,
): string {
  const agentLabel = actorName
    ? capitalize(actorName)
    : details.agent_id
      ? capitalize(String(details.agent_id))
      : "Agent";

  switch (action) {
    case "issue.created":
      return "Created issue";

    case "issue.status_changed": {
      const from = String(details.from || "").replace(/_/g, " ");
      const to = String(details.to || "").replace(/_/g, " ");
      return `Status: ${from} → ${to}`;
    }

    case "comment.added": {
      return `${agentLabel} posted a comment`;
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
      return `${agentLabel} spawned`;
    }

    case "mention.completed": {
      return `${agentLabel} finished — ${humanizeExitCode(details.exit_code)}`;
    }

    case "mention.error": {
      const message = String(details.message || "Unknown error");
      return `${agentLabel} error: ${message}`;
    }

    case "run.started":
      return `${agentLabel} run started`;

    case "run.completed": {
      const status = String(details.status || "unknown");
      const cost = details.cost_usd
        ? `$${Number(details.cost_usd).toFixed(4)}`
        : "—";
      const duration = details.duration_ms
        ? `${(Number(details.duration_ms) / 1000).toFixed(1)}s`
        : "—";
      return `${agentLabel} run finished (${status}). Cost: ${cost}. Duration: ${duration}`;
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

  // Resolve display name: prefer enriched actor_name, then details.agent_id
  const actorName =
    entry.actor_name ||
    (typeof (details as any).agent_id === "string"
      ? ((details as any).agent_id as string)
      : null);

  return {
    id: entry.id,
    timestamp: formatTimestamp(entry.created_at),
    actor: formatActor(entry.actor_type, entry.actor_id, entry.actor_name),
    actorType,
    message: formatActivityMessage(entry.action, details, actorName),
    issueId: entry.issue_id || undefined,
    issueTitle: entry.issue_title,
    severity: getSeverityForAction(entry.action, details),
    raw: entry,
  };
}

/**
 * Format a WebSocket event into a TerminalLine
 */
export function formatWsEvent(eventType: string, data: unknown): TerminalLine {
  const d = (data || {}) as Record<string, unknown>;
  const timestamp = String(d.timestamp || new Date().toISOString());
  const id = String(d.id || `ws-${Date.now()}-${Math.random()}`);

  // Determine actor and message based on event type
  let actor = "system";
  let actorType: "agent" | "system" | "user" = "system";
  let message = eventType.replace(/\./g, " ");
  let issueId: string | undefined;
  let issueTitle: string | undefined;
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
      const rawTo = String(d.to || "");
      const from = String(d.from || "").replace(/_/g, " ");
      const to = rawTo.replace(/_/g, " ");
      issueId = String(d.issue_id || "");
      if (d.actor_type) {
        actorType = String(d.actor_type) as any;
        actor = formatActor(
          String(d.actor_type),
          String(d.actor_id || ""),
          undefined,
        );
      }
      // Include actor name in message when it's an agent
      if (d.actor_type === "agent" && d.actor_id) {
        const actorLabel = capitalize(String(d.actor_id));
        message = `${actorLabel}: status ${from} → ${to}`;
      } else {
        message = `Status: ${from} → ${to}`;
      }
      if (rawTo === "done") severity = "success";
      else if (rawTo === "discarded") severity = "error";
      else severity = "warning"; // All other status changes default to warning (amber)
      break;
    }

    case "comment.added": {
      const comment = d.comment as any;
      const authorId = comment?.author_type || "unknown";
      // author_type for agent comments is the agent id (e.g. "engineer")
      const commentLabel = capitalize(String(authorId));
      message = `${commentLabel} posted a comment`;
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
      severity = "started";
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
      issueTitle = d.issue_title ? String(d.issue_title) : undefined;
      message = `${capitalize(agentName)} spawned`;
      severity = "started";
      break;
    }

    case "mention.completed": {
      const agentId = String(d.agent_id || "");
      const agentName = String(d.agent_name || agentId);
      actor = `agent:${agentName}`;
      actorType = "agent";
      issueId = String(d.issue_id || "");
      issueTitle = d.issue_title ? String(d.issue_title) : undefined;
      message = `${capitalize(agentName)} finished — ${humanizeExitCode(d.exit_code)}`;
      severity = Number(d.exit_code) === 0 ? "success" : "error";
      break;
    }

    case "mention.error": {
      const agentId = String(d.agent_id || "");
      const agentName = String(d.agent_name || agentId);
      actor = `agent:${agentName}`;
      actorType = "agent";
      issueId = String(d.issue_id || "");
      issueTitle = d.issue_title ? String(d.issue_title) : undefined;
      message = `${capitalize(agentName)} error: ${String(d.message || "Unknown error")}`;
      severity = "error";
      break;
    }

    case "mention.chain_depth_reached": {
      message = "Chain depth limit reached";
      issueId = String(d.issue_id || "");
      issueTitle = d.issue_title ? String(d.issue_title) : undefined;
      severity = "warning";
      break;
    }

    case "dispatch.queued": {
      const agentId = String(d.agent_id || "");
      const agentName = d.agent_name ? String(d.agent_name) : agentId;
      const position = d.position ?? "?";
      issueTitle = d.issue_title ? String(d.issue_title) : undefined;
      message = `${capitalize(agentName)} queued (position ${position})`;
      issueId = String(d.issue_id || "");
      break;
    }

    case "dispatch.dequeued": {
      const agentId = String(d.agent_id || "");
      const agentName = d.agent_name ? String(d.agent_name) : agentId;
      issueTitle = d.issue_title ? String(d.issue_title) : undefined;
      message = `${capitalize(agentName)} dequeued`;
      issueId = String(d.issue_id || "");
      break;
    }

    case "run.started": {
      const agentId = String(d.agent_id || "");
      actor = `agent:${agentId}`;
      actorType = "agent";
      message = `${capitalize(agentId)} run started`;
      issueId = String(d.issue_id || "");
      severity = "started";
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
      const cost = d.cost_usd ? `$${Number(d.cost_usd).toFixed(4)}` : "—";
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
    issueId: issueId || undefined,
    issueTitle,
    severity,
    raw: data,
  };
}
