import { randomUUID } from "crypto";
import { db } from "../db/index.js";
import { eventBus } from "./bus.js";

const BASE_ACTOR_TYPES = new Set(["user", "system"]);

function deriveActorType(authorType: string): {
  type: string;
  id: string | null;
} {
  if (BASE_ACTOR_TYPES.has(authorType)) {
    return { type: authorType, id: null };
  }
  // For agents, author_type is the agent ID (captain, engineer, etc.)
  return { type: "agent", id: authorType };
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
    const actor = deriveActorType(issue.created_by);
    log({
      project_id: issue.project_id,
      issue_id: issue.id,
      actor_type: actor.type,
      actor_id: actor.id,
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
    const actor = deriveActorType(comment.author_type);
    log({
      project_id,
      issue_id: comment.issue_id,
      actor_type: actor.type,
      actor_id: actor.id,
      action: "comment.added",
      details: { content_preview: comment.content.slice(0, 200) },
    });
  });

  eventBus.on("pr.created", ({ issue_pr, project_id }) => {
    log({
      project_id,
      issue_id: issue_pr.issue_id,
      actor_type: "system",
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

  eventBus.on("project.settings_changed", ({ project_id, changes }) => {
    log({
      project_id,
      actor_type: "user",
      action: "project.settings_changed",
      details: { changes },
    });
  });
}
