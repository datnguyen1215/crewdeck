import { randomUUID } from "crypto";
import { db } from "../db/index.js";
import { eventBus } from "./bus.js";

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
      actor_type: issue.created_by,
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
      actor_type: comment.author_type,
      actor_id: comment.author_id,
      action: "comment.added",
      details: { content_preview: comment.content.slice(0, 200) },
    });
  });

  eventBus.on("session.started", ({ project_id, issue_id, agent_id, tmux_session_name }) => {
    log({
      project_id,
      issue_id,
      actor_type: "system",
      action: "session.started",
      details: { agent_id, tmux_session_name },
    });
  });

  eventBus.on("session.ended", ({ project_id, status }) => {
    log({
      project_id,
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
}
