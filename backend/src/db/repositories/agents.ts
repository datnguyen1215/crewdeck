/** Agent repository — CRUD operations for project agents. */
import { db } from "../index.js";
import type { Agent, CreateAgentInput, UpdateAgentInput } from "../../types/entities.js";
import { buildAndRunUpdate } from "./utils.js";

export function listAgents(projectId: string): Agent[] {
  return db
    .prepare("SELECT * FROM Agent WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as Agent[];
}

export function getAgent(id: string): Agent | null {
  return (db.prepare("SELECT * FROM Agent WHERE id = ?").get(id) as Agent) ?? null;
}

export function findAgentByName(projectId: string, name: string): Agent | null {
  return (db
    .prepare("SELECT * FROM Agent WHERE project_id = ? AND name = ? COLLATE NOCASE")
    .get(projectId, name) as Agent) ?? null;
}

export function createAgent(projectId: string, input: CreateAgentInput): Agent {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO Agent (id, project_id, name, title, description, system_prompt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, input.name, input.title, input.description ?? null, input.system_prompt);
  return getAgent(id)!;
}

export function updateAgent(id: string, input: UpdateAgentInput): Agent {
  buildAndRunUpdate("Agent", id, input);
  return getAgent(id)!;
}

export function deleteAgent(id: string): void {
  db.prepare("DELETE FROM Agent WHERE id = ?").run(id);
}
