import { db } from "../index.js";
import type { Agent, CreateAgentInput, UpdateAgentInput } from "../../types/entities.js";

type AgentRow = Omit<Agent, "expertise" | "can_review"> & {
  expertise: string | null;
  can_review: number;
};

function fromRow(row: AgentRow): Agent {
  return {
    ...row,
    expertise: row.expertise ? (JSON.parse(row.expertise) as string[]) : [],
    can_review: row.can_review === 1,
  };
}

export function listAgents(crewId: string): Agent[] {
  const rows = db
    .prepare("SELECT * FROM Agent WHERE crew_id = ? ORDER BY created_at ASC")
    .all(crewId) as AgentRow[];
  return rows.map(fromRow);
}

export function getAgent(id: string): Agent | null {
  const row = db.prepare("SELECT * FROM Agent WHERE id = ?").get(id) as AgentRow | undefined;
  return row ? fromRow(row) : null;
}

export function createAgent(crewId: string, input: CreateAgentInput): Agent {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO Agent (id, crew_id, name, role, expertise, system_prompt, can_review)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    crewId,
    input.name,
    input.role,
    input.expertise ? JSON.stringify(input.expertise) : null,
    input.system_prompt,
    input.can_review !== undefined ? (input.can_review ? 1 : 0) : 1
  );
  return getAgent(id)!;
}

export function updateAgent(id: string, input: UpdateAgentInput): Agent {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.role !== undefined) { fields.push("role = ?"); values.push(input.role); }
  if (input.expertise !== undefined) { fields.push("expertise = ?"); values.push(JSON.stringify(input.expertise)); }
  if (input.system_prompt !== undefined) { fields.push("system_prompt = ?"); values.push(input.system_prompt); }
  if (input.can_review !== undefined) { fields.push("can_review = ?"); values.push(input.can_review ? 1 : 0); }

  if (fields.length > 0) {
    fields.push("updated_at = CURRENT_TIMESTAMP");
    db.prepare(`UPDATE Agent SET ${fields.join(", ")} WHERE id = ?`).run(...values, id);
  }

  return getAgent(id)!;
}

export function deleteAgent(id: string): void {
  db.prepare("DELETE FROM Agent WHERE id = ?").run(id);
}

export function hasActiveIssues(agentId: string): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM Issue
       WHERE assigned_agent_id = ? AND status NOT IN ('closed', 'cancelled')`
    )
    .get(agentId) as { count: number };
  return row.count > 0;
}
