import { db } from "../index.js";
import type {
  ProjectKnowledge,
  CreateKnowledgeInput,
  UpdateKnowledgeInput,
} from "../../types/entities.js";

export function listByProject(projectId: string): ProjectKnowledge[] {
  const rows = db
    .prepare(
      `SELECT * FROM ProjectKnowledge
       WHERE project_id = ?
       ORDER BY updated_at DESC, created_at DESC`
    )
    .all(projectId) as ProjectKnowledge[];
  return rows;
}

export function getById(id: string): ProjectKnowledge | null {
  const row = db
    .prepare("SELECT * FROM ProjectKnowledge WHERE id = ?")
    .get(id) as ProjectKnowledge | undefined;
  return row ?? null;
}

export function create(
  projectId: string,
  input: CreateKnowledgeInput
): ProjectKnowledge {
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO ProjectKnowledge (id, project_id, title, category, content, source)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, projectId, input.title, input.category, input.content, input.source ?? null);

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
