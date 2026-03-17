import { db } from "../index.js";

/**
 * Build and execute an UPDATE statement from a partial input object.
 * Only fields present (not undefined) in `input` are included.
 * Automatically appends `updated_at = CURRENT_TIMESTAMP`.
 *
 * @param table  SQL table name
 * @param id     Row id (used in WHERE clause)
 * @param input  Partial update object — undefined values are skipped
 * @param overrides  Pre-processed field/value pairs that bypass the simple
 *                   `input[key]` lookup (e.g. JSON-serialized or boolean-cast values)
 */
export function buildAndRunUpdate<T extends object>(
  table: string,
  id: string,
  input: T,
  overrides: Record<string, unknown> = {},
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];

  const processed = new Set(Object.keys(overrides));

  // Add overrides first
  for (const [key, value] of Object.entries(overrides)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }

  // Add remaining input fields
  for (const [key, value] of Object.entries(input)) {
    if (processed.has(key)) continue;
    if (value === undefined) continue;
    fields.push(`${key} = ?`);
    values.push(value);
  }

  if (fields.length === 0) return false;

  fields.push("updated_at = CURRENT_TIMESTAMP");
  db.prepare(`UPDATE ${table} SET ${fields.join(", ")} WHERE id = ?`).run(
    ...values,
    id,
  );
  return true;
}
