import { db } from "../index.js";
import type {
  AgentRun,
  AgentRunEvent,
  AgentRunWithEvents,
  AgentRunStatus,
} from "../../types/entities.js";
import { normalizeEvent } from "../../services/event-normalizer.js";

export type { NormalizedEventData } from "../../services/event-normalizer.js";

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

export function getAgentRunWithEvents(
  id: string,
  eventsLimit: number = 0,
): AgentRunWithEvents | null {
  const run = getAgentRun(id);
  if (!run) return null;
  const events =
    eventsLimit === 0
      ? listAgentRunEvents(id)
      : listRecentAgentRunEvents(id, eventsLimit);
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

interface AgentRunEventRow {
  id: string;
  agent_run_id: string;
  type: string;
  data: string;
  created_at: string;
}

function parseEventRow(row: AgentRunEventRow): AgentRunEvent {
  return normalizeEvent({
    id: row.id,
    agent_run_id: row.agent_run_id,
    type: row.type as AgentRunEvent["type"],
    data: JSON.parse(row.data),
    created_at: row.created_at,
  });
}

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
    | AgentRunEventRow
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
    .all(agentRunId) as AgentRunEventRow[];
  return rows.map(parseEventRow);
}

export function listRecentAgentRunEvents(
  agentRunId: string,
  limit: number = 50,
): AgentRunEvent[] {
  const rows = db
    .prepare(
      "SELECT * FROM (SELECT * FROM AgentRunEvent WHERE agent_run_id = ? ORDER BY created_at DESC LIMIT ?) ORDER BY created_at ASC",
    )
    .all(agentRunId, limit) as AgentRunEventRow[];
  return rows.map(parseEventRow);
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
    .prepare(
      "SELECT * FROM AgentRun WHERE status = 'queued' ORDER BY created_at ASC",
    )
    .all() as AgentRun[];
}

/**
 * Count running agent runs globally (across all projects).
 */
export function countRunningGlobal(): number {
  const result = db
    .prepare("SELECT COUNT(*) as count FROM AgentRun WHERE status = 'running'")
    .get() as { count: number };
  return result.count;
}
