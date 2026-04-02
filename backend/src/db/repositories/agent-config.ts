import { db } from "../index.js";
import type { AgentConfig } from "../../types/entities.js";
import * as globalConfigRepo from "./global-config.js";

export function list(): AgentConfig[] {
  return db.prepare("SELECT * FROM AgentConfig").all() as AgentConfig[];
}

export function get(agentId: string): AgentConfig | undefined {
  return db
    .prepare("SELECT * FROM AgentConfig WHERE agent_id = ?")
    .get(agentId) as AgentConfig | undefined;
}

export function upsert(agentId: string, model: string | null): AgentConfig {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO AgentConfig (id, agent_id, model)
     VALUES (?, ?, ?)
     ON CONFLICT(agent_id) DO UPDATE SET model = excluded.model`,
  ).run(id, agentId, model);

  return db
    .prepare("SELECT * FROM AgentConfig WHERE agent_id = ?")
    .get(agentId) as AgentConfig;
}

export function remove(agentId: string): boolean {
  const result = db
    .prepare("DELETE FROM AgentConfig WHERE agent_id = ?")
    .run(agentId);
  return result.changes > 0;
}

/** Resolve the model for an agent: agent config → global default */
export function resolveModel(agentId: string): string {
  const config = get(agentId);
  return config?.model ?? globalConfigRepo.getDefaultModel();
}
