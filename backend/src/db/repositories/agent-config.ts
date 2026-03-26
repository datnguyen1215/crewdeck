import { db } from "../index.js";
import type { AgentConfig } from "../../types/entities.js";

export function listByProject(projectId: string): AgentConfig[] {
  return db
    .prepare("SELECT * FROM AgentConfig WHERE project_id = ?")
    .all(projectId) as AgentConfig[];
}

export function get(
  projectId: string,
  agentId: string,
): AgentConfig | undefined {
  return db
    .prepare("SELECT * FROM AgentConfig WHERE project_id = ? AND agent_id = ?")
    .get(projectId, agentId) as AgentConfig | undefined;
}

export function upsert(
  projectId: string,
  agentId: string,
  model: string | null,
): AgentConfig {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO AgentConfig (id, project_id, agent_id, model)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, agent_id) DO UPDATE SET model = excluded.model`,
  ).run(id, projectId, agentId, model);

  return db
    .prepare("SELECT * FROM AgentConfig WHERE project_id = ? AND agent_id = ?")
    .get(projectId, agentId) as AgentConfig;
}

export function remove(projectId: string, agentId: string): boolean {
  const result = db
    .prepare("DELETE FROM AgentConfig WHERE project_id = ? AND agent_id = ?")
    .run(projectId, agentId);
  return result.changes > 0;
}

/**
 * Resolve the model for an agent: per-agent override → project default → "sonnet"
 */
export function resolveModel(projectId: string, agentId: string): string {
  const config = get(projectId, agentId);
  if (config?.model) return config.model;

  const row = db
    .prepare("SELECT model FROM Project WHERE id = ?")
    .get(projectId) as { model: string } | undefined;
  return row?.model ?? "sonnet";
}
