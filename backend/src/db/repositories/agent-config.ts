import { db } from "../index.js";
import type { AgentConfig } from "../../types/entities.js";
import * as globalConfigRepo from "./global-config.js";

const PROVIDER_DEFAULTS: Record<string, string> = {
  claude: "sonnet",
  glm: "glm-5-turbo",
};

export function list(): AgentConfig[] {
  return db.prepare("SELECT * FROM AgentConfig").all() as AgentConfig[];
}

export function get(agentId: string, provider: string): AgentConfig | undefined {
  return db
    .prepare("SELECT * FROM AgentConfig WHERE agent_id = ? AND provider = ?")
    .get(agentId, provider) as AgentConfig | undefined;
}

export function upsert(agentId: string, provider: string, model: string | null): AgentConfig {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO AgentConfig (id, agent_id, provider, model)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(agent_id, provider) DO UPDATE SET model = excluded.model`,
  ).run(id, agentId, provider, model);

  return db
    .prepare("SELECT * FROM AgentConfig WHERE agent_id = ? AND provider = ?")
    .get(agentId, provider) as AgentConfig;
}

export function remove(agentId: string, provider: string): boolean {
  const result = db
    .prepare("DELETE FROM AgentConfig WHERE agent_id = ? AND provider = ?")
    .run(agentId, provider);
  return result.changes > 0;
}

/**
 * Resolve the model for an agent: current provider config → provider default
 */
export function resolveModel(agentId: string): string {
  const provider = globalConfigRepo.getProvider();
  const config = get(agentId, provider);
  return config?.model ?? PROVIDER_DEFAULTS[provider] ?? "sonnet";
}
