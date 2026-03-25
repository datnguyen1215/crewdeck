import { randomUUID } from "crypto";
import { db } from "../db/index.js";
import { eventBus } from "./bus.js";

// Valid agent IDs for comment.author_type
const AGENT_IDS = new Set(["captain", "engineer", "lead", "docs", "librarian"]);

function sanitizeActorType(value: string): string {
  if (value === "user" || value === "system") return value;
  // "agent" is still valid for issue.created_by
  if (value === "agent") return "agent";
  // Agent IDs in comment.author_type map to "agent" for activity log
  if (AGENT_IDS.has(value)) return "agent";
  return "unknown";
}

function extractActorId(authorType: string): string | null {
  // If author_type is an agent ID, extract it for actor_id
  if (AGENT_IDS.has(authorType)) {
    return authorType;
  }
  return null;
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
    entry.details != null ? JSON.stringify(entry.details) : null,
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

  eventBus.on(
    "issue.status_changed",
    ({ project_id, issue_id, from, to, actor_type, actor_id }) => {
      log({
        project_id,
        issue_id,
        actor_type: actor_type ?? "system",
        actor_id,
        action: "issue.status_changed",
        details: { from, to },
      });
    },
  );

  eventBus.on("comment.added", ({ comment, project_id }) => {
    log({
      project_id,
      issue_id: comment.issue_id,
      actor_type: sanitizeActorType(comment.author_type),
      actor_id: extractActorId(comment.author_type),
      action: "comment.added",
      details: { content_preview: comment.content.slice(0, 200) },
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

  eventBus.on("mention.spawned", ({ project_id, issue_id, agent_id, pid }) => {
    log({
      project_id,
      issue_id,
      actor_type: "system",
      action: "mention.spawned",
      details: { agent_id, pid },
    });
  });

  eventBus.on(
    "mention.completed",
    ({ project_id, issue_id, agent_id, exit_code }) => {
      log({
        project_id,
        issue_id,
        actor_type: "system",
        action: "mention.completed",
        details: { agent_id, exit_code },
      });
    },
  );

  eventBus.on(
    "dispatch.queued",
    ({ project_id, issue_id, agent_id, position }) => {
      log({
        project_id,
        issue_id,
        actor_type: "system",
        action: "agent.queued",
        details: { agent_id, position },
      });
    },
  );

  eventBus.on("dispatch.dequeued", ({ project_id, issue_id, agent_id }) => {
    log({
      project_id,
      issue_id,
      actor_type: "system",
      action: "agent.dequeued",
      details: { agent_id },
    });
  });
}
