import { randomUUID } from "crypto";
import { db } from "../db/index.js";
import { getSession } from "../db/repositories/sessions.js";
import { eventBus } from "./bus.js";

// Exhaustive set of actor types written to the audit log.
// Any value outside this set is clamped to "unknown" to prevent callers
// from writing arbitrary strings into actor_type (e.g. via issue.created_by).
const VALID_ACTOR_TYPES = new Set(["user", "agent", "orchestrator", "system", "captain"]);

function sanitizeActorType(value: string): string {
  return VALID_ACTOR_TYPES.has(value) ? value : "unknown";
}

const insert = db.prepare(`
  INSERT INTO ActivityLog (id, project_id, issue_id, actor_type, actor_id, action, details)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

function log(entry: {
  project_id: string;
  issue_id?: string | null;
  actor_type: string;
  actor_id?: string | null;
  action: string;
  details?: unknown;
}) {
  insert.run(
    randomUUID(),
    entry.project_id,
    entry.issue_id ?? null,
    entry.actor_type,
    entry.actor_id ?? null,
    entry.action,
    entry.details != null ? JSON.stringify(entry.details) : null
  );
}

export function initActivityLogger(): void {
  eventBus.on("issue.created", ({ issue }) => {
    log({
      project_id: issue.project_id,
      issue_id: issue.id,
      actor_type: sanitizeActorType(issue.created_by),
      action: "issue.created",
      details: { title: issue.title },
    });
  });

  eventBus.on("issue.status_changed", ({ project_id, issue_id, from, to }) => {
    log({
      project_id,
      issue_id,
      actor_type: "system",
      action: "issue.status_changed",
      details: { from, to },
    });
  });

  eventBus.on("issue.assigned", ({ project_id, issue_id, agent_id, agent_name }) => {
    log({
      project_id,
      issue_id,
      actor_type: "orchestrator",
      action: "agent.assigned",
      details: { agent_id, agent_name },
    });
  });

  eventBus.on("comment.added", ({ comment, project_id }) => {
    log({
      project_id,
      issue_id: comment.issue_id,
      actor_type: sanitizeActorType(comment.author_type),
      actor_id: comment.author_id,
      action: "comment.added",
      details: { content_preview: comment.content.slice(0, 200) },
    });
  });

  eventBus.on("session.started", ({ project_id, issue_id, agent_id, tmux_session_name }) => {
    // tmux_session_name is an internal identifier, but we log it here intentionally for
    // session correlation in debugging (it ties an ActivityLog entry to a specific Session row).
    // It is not secret and already stored in the Session table.
    log({
      project_id,
      issue_id,
      actor_type: "system",
      action: "session.started",
      details: { agent_id, tmux_session_name },
    });
  });

  eventBus.on("session.ended", ({ session_id, project_id, status }) => {
    const session = getSession(session_id);
    log({
      project_id,
      issue_id: session?.issue_id ?? null,
      actor_type: "system",
      action: "session.ended",
      details: { status },
    });
  });

  eventBus.on("pr.created", ({ issue_pr, project_id }) => {
    log({
      project_id,
      issue_id: issue_pr.issue_id,
      actor_type: "user",
      action: "pr.created",
      details: { pr_number: issue_pr.pr_number, pr_url: issue_pr.pr_url },
    });
  });

  eventBus.on("orchestrator.decision", ({ project_id, action, details, reasoning, issue_id, agent_id }) => {
    log({
      project_id,
      issue_id: issue_id ?? null,
      actor_type: "captain",
      action: "captain.decision",
      details: { ...(details as object), action, reasoning, agent_id },
    });
  });

  eventBus.on("review.completed", ({ project_id, issue_id, agent_id, verdict }) => {
    log({
      project_id,
      issue_id,
      actor_type: "agent",
      actor_id: agent_id,
      action: "review.completed",
      details: { verdict },
    });
  });

  eventBus.on("agent.finished", ({ project_id, issue_id, agent_id, role }) => {
    log({
      project_id,
      issue_id,
      actor_type: "agent",
      actor_id: agent_id,
      action: "agent.finished",
      details: { role },
    });
  });

  eventBus.on("agent.error", ({ project_id, issue_id, agent_id, message }) => {
    log({
      project_id,
      issue_id,
      actor_type: "agent",
      actor_id: agent_id,
      action: "agent.error",
      details: { message },
    });
  });

  eventBus.on("agent.needs_help", ({ project_id, issue_id, agent_id, message }) => {
    log({
      project_id,
      issue_id,
      actor_type: "agent",
      actor_id: agent_id,
      action: "agent.needs_help",
      details: { message },
    });
  });
}
