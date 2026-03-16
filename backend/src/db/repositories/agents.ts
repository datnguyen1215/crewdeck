import { db } from "../index.js";
import type { Agent, CreateAgentInput, UpdateAgentInput } from "../../types/entities.js";

export function listAgents(crewId: string): Agent[] {
  return db
    .prepare("SELECT * FROM Agent WHERE crew_id = ? ORDER BY created_at ASC")
    .all(crewId) as Agent[];
}

export function getAgent(id: string): Agent | null {
  const row = db.prepare("SELECT * FROM Agent WHERE id = ?").get(id) as Agent | undefined;
  return row ?? null;
}

export function createAgent(crewId: string, input: CreateAgentInput): Agent {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO Agent (id, crew_id, name, title, description, system_prompt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    crewId,
    input.name,
    input.title,
    input.description ?? null,
    input.system_prompt
  );
  return getAgent(id)!;
}

export function updateAgent(id: string, input: UpdateAgentInput): Agent {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.title !== undefined) { fields.push("title = ?"); values.push(input.title); }
  if (input.description !== undefined) { fields.push("description = ?"); values.push(input.description); }
  if (input.system_prompt !== undefined) { fields.push("system_prompt = ?"); values.push(input.system_prompt); }

  if (fields.length > 0) {
    fields.push("updated_at = CURRENT_TIMESTAMP");
    db.prepare(`UPDATE Agent SET ${fields.join(", ")} WHERE id = ?`).run(...values, id);
  }

  return getAgent(id)!;
}

export function deleteAgent(id: string): void {
  db.transaction(() => {
    db.prepare("DELETE FROM IssueAgent WHERE agent_id = ?").run(id);
    db.prepare("UPDATE Session SET agent_id = NULL WHERE agent_id = ?").run(id);
    db.prepare("DELETE FROM Agent WHERE id = ?").run(id);
  })();
}

export function hasActiveIssues(agentId: string): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM Issue
       WHERE assigned_agent_id = ? AND status NOT IN ('done', 'closed', 'cancelled')`
    )
    .get(agentId) as { count: number };
  return row.count > 0;
}
