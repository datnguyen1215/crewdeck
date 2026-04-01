/**
 * Issue Dependencies Repository
 *
 * Manages dependencies between issues (issue A depends on issue B).
 */
import { db } from "../index.js";
import type {
  IssueDependency,
  IssueDependencySummary,
} from "../../types/entities.js";
import { getIssue } from "./issues.js";
import { logger } from "../../logger.js";

/**
 * List all issue IDs that the given issue depends on.
 */
export function listDependencies(issueId: string): string[] {
  const rows = db
    .prepare(
      "SELECT depends_on_issue_id FROM IssueDependency WHERE issue_id = ?",
    )
    .all(issueId) as { depends_on_issue_id: string }[];
  return rows.map((r) => r.depends_on_issue_id);
}

/**
 * List all issue IDs that depend on the given issue.
 */
export function listDependents(issueId: string): string[] {
  const rows = db
    .prepare(
      "SELECT issue_id FROM IssueDependency WHERE depends_on_issue_id = ?",
    )
    .all(issueId) as { issue_id: string }[];
  return rows.map((r) => r.issue_id);
}

/**
 * Check for circular dependencies.
 * Returns true if adding a dependency from issueId to dependsOnId would create a cycle.
 */
function wouldCreateCycle(issueId: string, dependsOnId: string): boolean {
  // BFS: Check if dependsOnId eventually depends on issueId
  const visited = new Set<string>();
  const queue = [dependsOnId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === issueId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const deps = listDependencies(current);
    queue.push(...deps);
  }

  return false;
}

/**
 * Add a single dependency.
 * Returns the created dependency or null if it would create a cycle,
 * issues don't exist, or issues are in different projects.
 */
export function addDependency(
  issueId: string,
  dependsOnId: string,
): IssueDependency | null {
  // Self-dependency check
  if (issueId === dependsOnId) return null;

  // Verify both issues exist and are in the same project
  const issue = getIssue(issueId);
  const depIssue = getIssue(dependsOnId);
  if (!issue || !depIssue) return null;
  if (issue.project_id !== depIssue.project_id) return null;

  // Circular dependency check
  if (wouldCreateCycle(issueId, dependsOnId)) return null;

  const id = crypto.randomUUID();
  try {
    db.prepare(
      `INSERT INTO IssueDependency (id, issue_id, depends_on_issue_id)
       VALUES (?, ?, ?)`,
    ).run(id, issueId, dependsOnId);
  } catch {
    // UNIQUE constraint violation - dependency already exists
    logger.debug(
      { issueId, dependsOnId },
      "Skipping duplicate dependency (already exists)",
    );
    return null;
  }

  return db
    .prepare("SELECT * FROM IssueDependency WHERE id = ?")
    .get(id) as IssueDependency;
}

/**
 * Remove a single dependency.
 */
export function removeDependency(
  issueId: string,
  dependsOnId: string,
): boolean {
  const result = db
    .prepare(
      "DELETE FROM IssueDependency WHERE issue_id = ? AND depends_on_issue_id = ?",
    )
    .run(issueId, dependsOnId);
  return result.changes > 0;
}

/**
 * Replace all dependencies for an issue.
 * Validates each dependency and prevents circular dependencies.
 * Returns the list of successfully set dependency IDs.
 */
export function setDependencies(
  issueId: string,
  dependsOnIds: string[],
): string[] {
  const issue = getIssue(issueId);
  if (!issue) return [];

  // Filter valid dependencies
  const validDeps = dependsOnIds.filter((depId) => {
    // Skip self-dependency
    if (depId === issueId) return false;
    // Verify dependency exists and is in the same project
    const depIssue = getIssue(depId);
    if (!depIssue) return false;
    if (depIssue.project_id !== issue.project_id) return false;
    return true;
  });

  // Use a transaction to atomically replace dependencies
  const transaction = db.transaction(() => {
    // Clear existing dependencies
    db.prepare("DELETE FROM IssueDependency WHERE issue_id = ?").run(issueId);

    const added: string[] = [];

    // Add new dependencies one by one, checking for cycles
    for (const depId of validDeps) {
      // Check if adding this would create a cycle
      if (wouldCreateCycle(issueId, depId)) continue;

      const id = crypto.randomUUID();
      try {
        db.prepare(
          `INSERT INTO IssueDependency (id, issue_id, depends_on_issue_id)
           VALUES (?, ?, ?)`,
        ).run(id, issueId, depId);
        added.push(depId);
      } catch {
        // Skip on constraint violation (dependency already exists within this transaction)
        logger.debug(
          { issueId, depId },
          "Skipping duplicate dependency in setDependencies",
        );
      }
    }

    return added;
  });

  return transaction();
}

/**
 * Generic batch query helper.
 * Runs a SQL query with IN (?) placeholders for issueIds, initializes a Map
 * with empty arrays for each id, then populates it using mapFn per row.
 */
function batchQuery<T>(
  issueIds: string[],
  sql: (placeholders: string) => string,
  mapFn: (row: Record<string, string>) => { key: string; value: T },
): Map<string, T[]> {
  if (issueIds.length === 0) return new Map();

  const placeholders = issueIds.map(() => "?").join(", ");
  const rows = db.prepare(sql(placeholders)).all(...issueIds) as Record<
    string,
    string
  >[];

  const result = new Map<string, T[]>();
  for (const issueId of issueIds) {
    result.set(issueId, []);
  }
  for (const row of rows) {
    const { key, value } = mapFn(row);
    result.get(key)!.push(value);
  }
  return result;
}

/**
 * Get dependencies for multiple issues at once (batch query).
 * Returns a map of issue_id -> [depends_on_issue_id, ...]
 */
export function listDependenciesBatch(
  issueIds: string[],
): Map<string, string[]> {
  return batchQuery(
    issueIds,
    (p) =>
      `SELECT issue_id, depends_on_issue_id FROM IssueDependency WHERE issue_id IN (${p})`,
    (row) => ({ key: row.issue_id, value: row.depends_on_issue_id }),
  );
}

/**
 * Get dependency summaries for multiple issues at once.
 * Returns a map of issue_id -> IssueDependencySummary[] (the issues it depends on).
 */
export function listDependenciesBatchWithDetails(
  issueIds: string[],
): Map<string, IssueDependencySummary[]> {
  return batchQuery(
    issueIds,
    (p) => `SELECT d.issue_id, i.id, i.title, i.status
       FROM IssueDependency d
       JOIN Issue i ON i.id = d.depends_on_issue_id
       WHERE d.issue_id IN (${p})`,
    (row) => ({
      key: row.issue_id,
      value: { id: row.id, title: row.title, status: row.status },
    }),
  );
}

/**
 * Get dependent summaries for multiple issues at once.
 * Returns a map of issue_id -> IssueDependencySummary[] (the issues that depend on it).
 */
export function listDependentsBatchWithDetails(
  issueIds: string[],
): Map<string, IssueDependencySummary[]> {
  return batchQuery(
    issueIds,
    (p) => `SELECT d.depends_on_issue_id AS issue_id, i.id, i.title, i.status
       FROM IssueDependency d
       JOIN Issue i ON i.id = d.issue_id
       WHERE d.depends_on_issue_id IN (${p})`,
    (row) => ({
      key: row.issue_id,
      value: { id: row.id, title: row.title, status: row.status },
    }),
  );
}
