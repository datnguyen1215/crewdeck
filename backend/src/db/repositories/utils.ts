import { db } from "../index.js";

type Table = "Agent" | "IssueAgent" | "IssuePR" | "Issue" | "Project" | "Session";

const ALLOWED_COLUMNS: Record<Table, Set<string>> = {
  Agent: new Set(["name", "title", "description", "system_prompt", "is_captain", "status"]),
  IssueAgent: new Set(["status", "review_order", "review_round", "session_id"]),
  IssuePR: new Set(["status", "pr_url"]),
  Issue: new Set(["title", "description", "status", "priority", "assigned_agent_id", "max_review_rounds", "current_review_round", "branch_name", "worktree_path", "base_branch", "repo_id"]),
  Project: new Set(["name", "description", "max_concurrency", "max_review_rounds", "orchestrator_session_id", "github_account_id"]),
  Session: new Set(["session_type", "agent_id", "issue_id", "tmux_session_name", "tmux_pane_id", "status", "context"]),
};

/**
 * Build and execute an UPDATE statement from a partial input object.
 * Only fields present (not undefined) in `input` are included.
 * Automatically appends `updated_at = CURRENT_TIMESTAMP`.
 *
 * @param table  SQL table name (restricted to known tables)
 * @param id     Row id (used in WHERE clause)
 * @param input  Partial update object — undefined values are skipped
 * @param overrides  Pre-processed field/value pairs that bypass the simple
 *                   `input[key]` lookup (e.g. JSON-serialized or boolean-cast values)
 */
export function buildAndRunUpdate<T extends object>(
  table: Table,
  id: string,
  input: T,
  overrides: Record<string, unknown> = {},
): void {
  const allowed = ALLOWED_COLUMNS[table];
  const fields: string[] = [];
  const values: unknown[] = [];

  const processed = new Set(Object.keys(overrides));

  // Add overrides first
  for (const [key, value] of Object.entries(overrides)) {
    if (!allowed.has(key)) continue;
    fields.push(`${key} = ?`);
    values.push(value);
  }

  // Add remaining input fields
  for (const [key, value] of Object.entries(input)) {
    if (processed.has(key)) continue;
    if (value === undefined) continue;
    if (!allowed.has(key)) continue;
    fields.push(`${key} = ?`);
    values.push(value);
  }

  if (fields.length === 0) return;

  fields.push("updated_at = CURRENT_TIMESTAMP");
  db.prepare(`UPDATE ${table} SET ${fields.join(", ")} WHERE id = ?`).run(
    ...values,
    id,
  );
}

/**
 * Parse a JSON string column into its deserialized value, returning null for
 * null/undefined inputs. Used by repository fromRow() functions to convert
 * stringified JSON columns back into objects.
 */
export function deserializeJson(value: string | null | undefined): unknown {
  return value ? (JSON.parse(value) as unknown) : null;
}
