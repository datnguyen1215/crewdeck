import { db } from "../index.js";
import type { Agent, CreateAgentInput, UpdateAgentInput } from "../../types/entities.js";
import { buildAndRunUpdate } from "./utils.js";

function normalize(row: Agent): Agent {
  return { ...row, is_captain: !!row.is_captain };
}

export function listAgents(crewId: string): Agent[] {
  const rows = db
    .prepare("SELECT * FROM Agent WHERE crew_id = ? ORDER BY created_at ASC")
    .all(crewId) as Agent[];
  return rows.map(normalize);
}

export function getAgent(id: string): Agent | null {
  const row = db.prepare("SELECT * FROM Agent WHERE id = ?").get(id) as Agent | undefined;
  return row ? normalize(row) : null;
}

export function getCaptain(crewId: string): Agent | null {
  const row = db
    .prepare("SELECT * FROM Agent WHERE crew_id = ? AND is_captain = 1")
    .get(crewId) as Agent | undefined;
  return row ? normalize(row) : null;
}

export function createAgent(crewId: string, input: CreateAgentInput): Agent {
  const id = crypto.randomUUID();
  const isCaptain = input.is_captain ? 1 : 0;

  // Enforce one captain per crew
  if (isCaptain) {
    db.prepare("UPDATE Agent SET is_captain = 0 WHERE crew_id = ? AND is_captain = 1").run(crewId);
  }

  db.prepare(
    `INSERT INTO Agent (id, crew_id, name, title, description, system_prompt, is_captain)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    crewId,
    input.name,
    input.title,
    input.description ?? null,
    input.system_prompt,
    isCaptain
  );
  return getAgent(id)!;
}

export function updateAgent(id: string, input: UpdateAgentInput): Agent {
  const overrides: Record<string, unknown> = {};

  if (input.is_captain !== undefined) {
    const isCaptain = input.is_captain ? 1 : 0;
    // Enforce one captain per crew
    if (isCaptain) {
      const agent = getAgent(id);
      if (agent) {
        db.prepare("UPDATE Agent SET is_captain = 0 WHERE crew_id = ? AND is_captain = 1 AND id != ?").run(agent.crew_id, id);
      }
    }
    overrides.is_captain = isCaptain;
  }

  buildAndRunUpdate("Agent", id, input, overrides);
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
