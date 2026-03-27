import { db } from "../index.js";
import type {
  AgentRun,
  AgentRunEvent,
  AgentRunWithEvents,
  AgentRunStatus,
} from "../../types/entities.js";

/**
 * Normalized event structure for frontend consumption.
 * Flattens Claude CLI's nested message.content[] structure.
 */
export interface NormalizedEventData {
  text?: string;
  thinking?: string;
  tool_use?: { id: string; name: string; input: unknown }[];
  tool_results?: { tool_use_id: string; output: string; is_error?: boolean }[];
  model?: string;
  subtype?: string;
  result?: string;
  message?: string;
  error?: string;
  cost_usd?: number;
  duration_ms?: number;
}

/**
 * Normalizes a raw Claude CLI event into a flat structure.
 * Extracts text, tool_use, tool_result from nested message.content[].
 */
export function normalizeEvent(event: AgentRunEvent): AgentRunEvent {
  // Guard: if data is missing or not an object, return event unchanged
  if (!event.data || typeof event.data !== "object") {
    return event;
  }

  const raw = event.data as Record<string, unknown>;
  const normalized: NormalizedEventData = {};

  switch (event.type) {
    case "assistant": {
      const message = raw.message as Record<string, unknown> | undefined;
      const contentArr = message?.content ?? raw.content;
      if (Array.isArray(contentArr)) {
        // Extract text blocks
        const textBlocks = contentArr
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .filter(Boolean);
        if (textBlocks.length > 0) {
          normalized.text = textBlocks.join("\n");
        }

        // Extract thinking blocks
        const thinkingBlocks = contentArr
          .filter((c: any) => c.type === "thinking")
          .map((c: any) => c.thinking)
          .filter(Boolean);
        if (thinkingBlocks.length > 0) {
          normalized.thinking = thinkingBlocks.join("\n");
        }

        // Extract tool_use blocks
        const toolUseBlocks = contentArr
          .filter((c: any) => c.type === "tool_use")
          .map((c: any) => ({
            id: c.id,
            name: c.name,
            input: c.input,
          }));
        if (toolUseBlocks.length > 0) {
          normalized.tool_use = toolUseBlocks;
        }
      }
      // If nothing extracted, return original event unchanged
      if (Object.keys(normalized).length === 0) {
        return event;
      }
      break;
    }

    case "user": {
      const message = raw.message as Record<string, unknown> | undefined;
      const contentArr = message?.content ?? raw.content;
      if (Array.isArray(contentArr)) {
        // Extract tool_result blocks
        const toolResults = contentArr
          .filter((c: any) => c.type === "tool_result")
          .map((c: any) => {
            let output = "";
            if (typeof c.content === "string") {
              output = c.content;
            } else if (Array.isArray(c.content)) {
              const textPart = c.content.find((p: any) => p.type === "text");
              output = textPart?.text ?? "";
            }
            return {
              tool_use_id: c.tool_use_id ?? "",
              output,
              is_error: c.is_error,
            };
          });
        if (toolResults.length > 0) {
          normalized.tool_results = toolResults;
        }

        // Also extract text blocks from user events (e.g. user messages)
        const textBlocks = contentArr
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .filter(Boolean);
        if (textBlocks.length > 0) {
          normalized.text = textBlocks.join("\n");
        }
      }
      // If nothing extracted, return original event unchanged
      if (Object.keys(normalized).length === 0) {
        return event;
      }
      break;
    }

    case "system": {
      // Pass through relevant fields
      if (typeof raw.model === "string") normalized.model = raw.model;
      if (typeof raw.subtype === "string") normalized.subtype = raw.subtype;
      if (typeof raw.message === "string") normalized.message = raw.message;
      break;
    }

    case "result": {
      if (typeof raw.result === "string") normalized.result = raw.result;
      if (typeof raw.cost_usd === "number") normalized.cost_usd = raw.cost_usd;
      if (typeof raw.total_cost_usd === "number")
        normalized.cost_usd = raw.total_cost_usd as number;
      if (typeof raw.duration_ms === "number")
        normalized.duration_ms = raw.duration_ms;
      break;
    }

    case "error": {
      normalized.error =
        typeof raw.error === "string"
          ? raw.error
          : typeof raw.message === "string"
            ? raw.message
            : "Unknown error";
      break;
    }

    case "tool_use": {
      // Already flat format from some paths - normalize
      const name = (raw.name ?? raw.tool_name ?? "") as string;
      const input = raw.input;
      if (name) {
        normalized.tool_use = [{ id: (raw.id ?? "") as string, name, input }];
      }
      break;
    }

    case "tool_result": {
      // Already flat format from some paths - normalize
      let output = "";
      if (typeof raw.output === "string") output = raw.output;
      else if (typeof raw.content === "string") output = raw.content;
      else if (typeof raw.result === "string") output = raw.result;
      normalized.tool_results = [
        {
          tool_use_id: (raw.tool_use_id ?? "") as string,
          output,
          is_error: raw.is_error as boolean | undefined,
        },
      ];
      break;
    }

    default:
      // Pass through unknown types as-is
      return event;
  }

  return {
    ...event,
    data: normalized,
  };
}

export interface CreateAgentRunInput {
  project_id: string;
  issue_id?: string | null;
  agent_id: string;
  pid?: number;
  status?: AgentRunStatus;
}

export interface UpdateAgentRunInput {
  pid?: number;
  status?: AgentRunStatus;
  exit_code?: number;
  cost_usd?: number;
  duration_ms?: number;
  started_at?: string;
  completed_at?: string;
}

export function createAgentRun(input: CreateAgentRunInput): AgentRun {
  const id = crypto.randomUUID();
  const status = input.status ?? "running";
  const startedAt = status === "running" ? new Date().toISOString() : null;

  db.prepare(
    `INSERT INTO AgentRun (id, project_id, issue_id, agent_id, pid, status, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.project_id,
    input.issue_id ?? null,
    input.agent_id,
    input.pid ?? null,
    status,
    startedAt,
  );

  return getAgentRun(id)!;
}

export function getAgentRun(id: string): AgentRun | null {
  return (
    (db.prepare("SELECT * FROM AgentRun WHERE id = ?").get(id) as AgentRun) ??
    null
  );
}

export function updateAgentRun(
  id: string,
  input: UpdateAgentRunInput,
): AgentRun | null {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.pid !== undefined) {
    fields.push("pid = ?");
    values.push(input.pid);
  }
  if (input.status !== undefined) {
    fields.push("status = ?");
    values.push(input.status);
  }
  if (input.exit_code !== undefined) {
    fields.push("exit_code = ?");
    values.push(input.exit_code);
  }
  if (input.cost_usd !== undefined) {
    fields.push("cost_usd = ?");
    values.push(input.cost_usd);
  }
  if (input.duration_ms !== undefined) {
    fields.push("duration_ms = ?");
    values.push(input.duration_ms);
  }
  if (input.started_at !== undefined) {
    fields.push("started_at = ?");
    values.push(input.started_at);
  }
  if (input.completed_at !== undefined) {
    fields.push("completed_at = ?");
    values.push(input.completed_at);
  }

  if (fields.length === 0) return getAgentRun(id);

  values.push(id);
  db.prepare(`UPDATE AgentRun SET ${fields.join(", ")} WHERE id = ?`).run(
    ...values,
  );
  return getAgentRun(id);
}

export function listAgentRunsForIssue(issueId: string): AgentRun[] {
  return db
    .prepare(
      "SELECT * FROM AgentRun WHERE issue_id = ? ORDER BY created_at DESC",
    )
    .all(issueId) as AgentRun[];
}

export function listAgentRunsForProject(
  projectId: string,
  options?: { limit?: number; offset?: number },
): AgentRun[] {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  return db
    .prepare(
      "SELECT * FROM AgentRun WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    )
    .all(projectId, limit, offset) as AgentRun[];
}

export function getAgentRunWithEvents(id: string): AgentRunWithEvents | null {
  const run = getAgentRun(id);
  if (!run) return null;
  const events = listAgentRunEvents(id);
  return { ...run, events };
}

export function listRunningAgentRuns(): AgentRun[] {
  return db
    .prepare("SELECT * FROM AgentRun WHERE status = 'running'")
    .all() as AgentRun[];
}

export function listActiveRunsForProject(projectId: string): AgentRun[] {
  return db
    .prepare(
      "SELECT * FROM AgentRun WHERE project_id = ? AND status IN ('running', 'queued') ORDER BY created_at ASC",
    )
    .all(projectId) as AgentRun[];
}

export function getLatestLibrarianRun(projectId: string): AgentRun | null {
  return (
    (db
      .prepare(
        `SELECT * FROM AgentRun
     WHERE project_id = ? AND agent_id = 'librarian'
     ORDER BY created_at DESC LIMIT 1`,
      )
      .get(projectId) as AgentRun) ?? null
  );
}

export function markRunFailed(id: string): AgentRun | null {
  const run = getAgentRun(id);
  const completedAt = new Date().toISOString();

  // Calculate duration if we have a start time
  let durationMs: number | undefined;
  if (run?.started_at) {
    durationMs =
      new Date(completedAt).getTime() - new Date(run.started_at).getTime();
  }

  return updateAgentRun(id, {
    status: "failed",
    exit_code: -1, // Indicates abnormal termination (e.g., server restart)
    duration_ms: durationMs,
    cost_usd: 0, // No cost data available for interrupted runs
    completed_at: completedAt,
  });
}

// AgentRunEvent functions
export function createAgentRunEvent(
  agentRunId: string,
  type: string,
  data: unknown,
): AgentRunEvent {
  const id = crypto.randomUUID();
  const dataStr = JSON.stringify(data);
  db.prepare(
    `INSERT INTO AgentRunEvent (id, agent_run_id, type, data) VALUES (?, ?, ?, ?)`,
  ).run(id, agentRunId, type, dataStr);
  return getAgentRunEvent(id)!;
}

export function getAgentRunEvent(id: string): AgentRunEvent | null {
  const row = db.prepare("SELECT * FROM AgentRunEvent WHERE id = ?").get(id) as
    | {
        id: string;
        agent_run_id: string;
        type: string;
        data: string;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    agent_run_id: row.agent_run_id,
    type: row.type as AgentRunEvent["type"],
    data: JSON.parse(row.data),
    created_at: row.created_at,
  };
}

export function listAgentRunEvents(agentRunId: string): AgentRunEvent[] {
  const rows = db
    .prepare(
      "SELECT * FROM AgentRunEvent WHERE agent_run_id = ? ORDER BY created_at ASC",
    )
    .all(agentRunId) as {
    id: string;
    agent_run_id: string;
    type: string;
    data: string;
    created_at: string;
  }[];
  return rows.map((row) =>
    normalizeEvent({
      id: row.id,
      agent_run_id: row.agent_run_id,
      type: row.type as AgentRunEvent["type"],
      data: JSON.parse(row.data),
      created_at: row.created_at,
    }),
  );
}

export function listRecentAgentRunEvents(
  agentRunId: string,
  limit: number = 50,
): AgentRunEvent[] {
  const rows = db
    .prepare(
      "SELECT * FROM (SELECT * FROM AgentRunEvent WHERE agent_run_id = ? ORDER BY created_at DESC LIMIT ?) ORDER BY created_at ASC",
    )
    .all(agentRunId, limit) as {
    id: string;
    agent_run_id: string;
    type: string;
    data: string;
    created_at: string;
  }[];
  return rows.map((row) =>
    normalizeEvent({
      id: row.id,
      agent_run_id: row.agent_run_id,
      type: row.type as AgentRunEvent["type"],
      data: JSON.parse(row.data),
      created_at: row.created_at,
    }),
  );
}

/**
 * List queued runs in FIFO order (oldest created_at first).
 * Used by the dispatch queue to process runs in order.
 */
export function listQueuedRuns(projectId?: string): AgentRun[] {
  if (projectId) {
    return db
      .prepare(
        "SELECT * FROM AgentRun WHERE project_id = ? AND status = 'queued' ORDER BY created_at ASC",
      )
      .all(projectId) as AgentRun[];
  }
  return db
    .prepare("SELECT * FROM AgentRun WHERE status = 'queued' ORDER BY created_at ASC")
    .all() as AgentRun[];
}

/**
 * Count running agent runs globally (across all projects).
 * Used to enforce global concurrency limits.
 */
export function countRunningGlobal(): number {
  const result = db
    .prepare("SELECT COUNT(*) as count FROM AgentRun WHERE status = 'running'")
    .get() as { count: number };
  return result.count;
}

/**
 * Count running agent runs for a specific project.
 * Used to enforce per-project concurrency limits.
 */
export function countRunningForProject(projectId: string): number {
  const result = db
    .prepare(
      "SELECT COUNT(*) as count FROM AgentRun WHERE project_id = ? AND status = 'running'",
    )
    .get(projectId) as { count: number };
  return result.count;
}
