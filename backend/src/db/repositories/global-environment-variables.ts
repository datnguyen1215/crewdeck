import { db } from "../index.js";
import type {
  GlobalEnvironmentVariable,
  CreateGlobalEnvironmentVariableInput,
  UpdateGlobalEnvironmentVariableInput,
} from "../../types/entities.js";

function fromRow(row: Record<string, unknown>): GlobalEnvironmentVariable {
  return {
    ...(row as Omit<GlobalEnvironmentVariable, "is_secret">),
    is_secret: Boolean(row.is_secret),
  };
}

export function list(): GlobalEnvironmentVariable[] {
  const rows = db
    .prepare("SELECT * FROM GlobalEnvironmentVariable ORDER BY key ASC")
    .all() as Record<string, unknown>[];
  return rows.map(fromRow);
}

export function get(id: string): GlobalEnvironmentVariable | null {
  const row = db
    .prepare("SELECT * FROM GlobalEnvironmentVariable WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? fromRow(row) : null;
}

export function getByKey(key: string): GlobalEnvironmentVariable | null {
  const row = db
    .prepare("SELECT * FROM GlobalEnvironmentVariable WHERE key = ?")
    .get(key) as Record<string, unknown> | undefined;
  return row ? fromRow(row) : null;
}

export function create(
  input: CreateGlobalEnvironmentVariableInput,
): GlobalEnvironmentVariable {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO GlobalEnvironmentVariable (id, key, value, is_secret)
     VALUES (?, ?, ?, ?)`,
  ).run(id, input.key, input.value, input.is_secret ? 1 : 0);
  return get(id)!;
}

export function update(
  id: string,
  input: UpdateGlobalEnvironmentVariableInput,
): GlobalEnvironmentVariable {
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
      `UPDATE GlobalEnvironmentVariable SET ${fields.join(", ")} WHERE id = ?`,
    ).run(...values, id);
  }

  return get(id)!;
}

export function remove(id: string): void {
  db.prepare("DELETE FROM GlobalEnvironmentVariable WHERE id = ?").run(id);
}

/** Returns a key→value map of all global env vars (for session injection). */
export function getMap(): Record<string, string> {
  const rows = db
    .prepare("SELECT key, value FROM GlobalEnvironmentVariable")
    .all() as { key: string; value: string }[];
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}
