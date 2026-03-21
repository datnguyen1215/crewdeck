import { db } from "../index.js";
import type {
  ProjectKnowledge,
  CreateKnowledgeInput,
  UpdateKnowledgeInput,
} from "../../types/entities.js";

type KnowledgeRow = Omit<ProjectKnowledge, "agent_ids"> & { agent_ids: string | null };

function fromRow(row: KnowledgeRow): ProjectKnowledge {
  return {
    ...row,
    agent_ids: row.agent_ids ? JSON.parse(row.agent_ids) : null,
  };
}

export function listByProject(projectId: string): ProjectKnowledge[] {
  const rows = db
    .prepare(
      `SELECT * FROM ProjectKnowledge
       WHERE project_id = ?
       ORDER BY updated_at DESC, created_at DESC`
    )
    .all(projectId) as KnowledgeRow[];
  return rows.map(fromRow);
}

export function getById(id: string): ProjectKnowledge | null {
  const row = db
    .prepare("SELECT * FROM ProjectKnowledge WHERE id = ?")
    .get(id) as KnowledgeRow | undefined;
  return row ? fromRow(row) : null;
}

export function create(
  projectId: string,
  input: CreateKnowledgeInput
): ProjectKnowledge {
  const id = crypto.randomUUID();
  const agentIds = input.agent_ids !== undefined
    ? (input.agent_ids ? JSON.stringify(input.agent_ids) : null)
    : null;

  db.prepare(
    `INSERT INTO ProjectKnowledge (id, project_id, title, category, content, source, agent_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, projectId, input.title, input.category, input.content, input.source ?? null, agentIds);

  return getById(id)!;
}

export function update(id: string, input: UpdateKnowledgeInput): ProjectKnowledge {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.title !== undefined) {
    fields.push("title = ?");
    values.push(input.title);
  }
  if (input.category !== undefined) {
    fields.push("category = ?");
    values.push(input.category);
  }
  if (input.content !== undefined) {
    fields.push("content = ?");
    values.push(input.content);
  }
  if (input.source !== undefined) {
    fields.push("source = ?");
    values.push(input.source);
  }
  if (input.agent_ids !== undefined) {
    fields.push("agent_ids = ?");
    values.push(input.agent_ids ? JSON.stringify(input.agent_ids) : null);
  }

  if (fields.length > 0) {
    fields.push("updated_at = CURRENT_TIMESTAMP");
    db.prepare(
      `UPDATE ProjectKnowledge SET ${fields.join(", ")} WHERE id = ?`
    ).run(...values, id);
  }

  return getById(id)!;
}

export function remove(id: string): void {
  db.prepare("DELETE FROM ProjectKnowledge WHERE id = ?").run(id);
}

export function listForAgent(projectId: string, agentId: string): ProjectKnowledge[] {
  // Validate agentId is a valid UUID to prevent any pattern injection
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(agentId)) {
    return [];
  }

  const pattern = `%"${agentId}"%`;
  const rows = db
    .prepare(
      `SELECT * FROM ProjectKnowledge
       WHERE project_id = ?
         AND (agent_ids IS NULL OR agent_ids LIKE ?)
       ORDER BY updated_at DESC, created_at DESC`
    )
    .all(projectId, pattern) as KnowledgeRow[];
  return rows.map(fromRow);
}
