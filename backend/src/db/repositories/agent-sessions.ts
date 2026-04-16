import { db } from "../index.js";
import type { AgentSession } from "../../types/entities.js";

export function upsertSession(
  projectId: string,
  issueId: string,
  agentId: string,
  sessionId: string,
): AgentSession {
  db.prepare(
    `INSERT INTO AgentSession (project_id, issue_id, agent_id, session_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, issue_id, agent_id) DO UPDATE SET
       session_id = excluded.session_id,
       updated_at = datetime('now')`,
  ).run(projectId, issueId, agentId, sessionId);

  return getSession(projectId, issueId, agentId)!;
}

export function getSession(
  projectId: string,
  issueId: string,
  agentId: string,
): AgentSession | null {
  return (
    (db
      .prepare(
        "SELECT * FROM AgentSession WHERE project_id = ? AND issue_id = ? AND agent_id = ?",
      )
      .get(projectId, issueId, agentId) as AgentSession) ?? null
  );
}

export function deleteSession(
  projectId: string,
  issueId: string,
  agentId: string,
): void {
  db.prepare(
    "DELETE FROM AgentSession WHERE project_id = ? AND issue_id = ? AND agent_id = ?",
  ).run(projectId, issueId, agentId);
}

export function deleteByIssue(issueId: string): void {
  db.prepare("DELETE FROM AgentSession WHERE issue_id = ?").run(issueId);
}

export function deleteByProject(projectId: string): void {
  db.prepare("DELETE FROM AgentSession WHERE project_id = ?").run(projectId);
}

export function listByIssue(issueId: string): AgentSession[] {
  return db
    .prepare("SELECT * FROM AgentSession WHERE issue_id = ? ORDER BY agent_id ASC")
    .all(issueId) as AgentSession[];
}
