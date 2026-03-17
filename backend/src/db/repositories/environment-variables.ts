import { db } from "../index.js";
import type {
  EnvironmentVariable,
  CreateEnvironmentVariableInput,
  UpdateEnvironmentVariableInput,
} from "../../types/entities.js";

function fromRow(row: Record<string, unknown>): EnvironmentVariable {
  return {
    ...(row as Omit<EnvironmentVariable, "is_secret">),
    is_secret: Boolean(row.is_secret),
  };
}

export function listEnvironmentVariables(
  projectId: string,
): EnvironmentVariable[] {
  const rows = db
    .prepare(
      "SELECT * FROM EnvironmentVariable WHERE project_id = ? ORDER BY key ASC",
    )
    .all(projectId) as Record<string, unknown>[];
  return rows.map(fromRow);
}

export function getEnvironmentVariable(id: string): EnvironmentVariable | null {
  const row = db
    .prepare("SELECT * FROM EnvironmentVariable WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? fromRow(row) : null;
}

export function getEnvironmentVariableByKey(
  projectId: string,
  key: string,
): EnvironmentVariable | null {
  const row = db
    .prepare(
      "SELECT * FROM EnvironmentVariable WHERE project_id = ? AND key = ?",
    )
    .get(projectId, key) as Record<string, unknown> | undefined;
  return row ? fromRow(row) : null;
}

export function createEnvironmentVariable(
  projectId: string,
  input: CreateEnvironmentVariableInput,
): EnvironmentVariable {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO EnvironmentVariable (id, project_id, key, value, is_secret)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, projectId, input.key, input.value, input.is_secret ? 1 : 0);
  return getEnvironmentVariable(id)!;
}

export function updateEnvironmentVariable(
  id: string,
  input: UpdateEnvironmentVariableInput,
): EnvironmentVariable {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.key !== undefined) {
    fields.push("key = ?");
    values.push(input.key);
  }
  if (input.value !== undefined) {
    fields.push("value = ?");
    values.push(input.value);
  }
  if (input.is_secret !== undefined) {
    fields.push("is_secret = ?");
    values.push(input.is_secret ? 1 : 0);
  }

  if (fields.length > 0) {
    fields.push("updated_at = CURRENT_TIMESTAMP");
    db.prepare(
      `UPDATE EnvironmentVariable SET ${fields.join(", ")} WHERE id = ?`,
    ).run(...values, id);
  }

  return getEnvironmentVariable(id)!;
}

export function deleteEnvironmentVariable(id: string): void {
  db.prepare("DELETE FROM EnvironmentVariable WHERE id = ?").run(id);
}

export function deleteAllEnvironmentVariables(projectId: string): void {
  db.prepare("DELETE FROM EnvironmentVariable WHERE project_id = ?").run(
    projectId,
  );
}

/** Returns a key→value map of all env vars for a project (for session injection). */
export function getEnvironmentVariablesMap(
  projectId: string,
): Record<string, string> {
  const rows = db
    .prepare("SELECT key, value FROM EnvironmentVariable WHERE project_id = ?")
    .all(projectId) as { key: string; value: string }[];
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}
