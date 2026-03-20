import { db } from "../index.js";

export interface AgentRun {
  id: string;
  project_id: string;
  issue_id: string;
  agent_id: string;
  pid: number;
  status: "running" | "completed" | "failed" | "timeout";
  exit_code: number | null;
  started_at: string;
  completed_at: string | null;
}

export function createAgentRun(
  projectId: string,
  issueId: string,
  agentId: string,
  pid: number,
): AgentRun {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO AgentRun (id, project_id, issue_id, agent_id, pid, status)
     VALUES (?, ?, ?, ?, ?, 'running')`,
  ).run(id, projectId, issueId, agentId, pid);
  return getAgentRun(id)!;
}

export function getAgentRun(id: string): AgentRun | null {
  return (db.prepare("SELECT * FROM AgentRun WHERE id = ?").get(id) as AgentRun) ?? null;
}

export function completeAgentRun(
  id: string,
  status: "completed" | "failed" | "timeout",
  exitCode: number | null,
): void {
  db.prepare(
    `UPDATE AgentRun SET status = ?, exit_code = ?, completed_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(status, exitCode, id);
}

export function listRunningAgentRuns(): AgentRun[] {
  return db.prepare("SELECT * FROM AgentRun WHERE status = 'running'").all() as AgentRun[];
}

export function markOrphanedRunsFailed(): AgentRun[] {
  const orphans = listRunningAgentRuns();
  if (orphans.length > 0) {
    db.prepare(
      `UPDATE AgentRun SET status = 'failed', completed_at = CURRENT_TIMESTAMP
       WHERE status = 'running'`,
    ).run();
  }
  return orphans;
}
