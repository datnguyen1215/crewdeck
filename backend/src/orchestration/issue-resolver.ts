import { logger } from "../logger.js";
import * as issueRepo from "../db/repositories/issues.js";

/** Standard UUID length (32 hex + 4 hyphens) */
export const UUID_LENGTH = 36;

/**
 * Resolve a potentially truncated issue ID to a full UUID.
 * If the ID is already a full UUID or found by exact match, returns it as-is.
 * If it looks like a prefix (shorter than a full UUID), tries prefix matching
 * scoped to the project. Returns null if not found or ambiguous.
 */
export function resolveIssueId(
  issueId: string,
  projectId: string,
): string | null {
  const exact = issueRepo.getIssue(issueId);
  if (exact) return exact.id;

  if (issueId.length < UUID_LENGTH && issueId.length >= 8) {
    const match = issueRepo.getIssueByPrefix(issueId, projectId);
    if (match) {
      logger.info(
        { prefix: issueId, resolved: match.id },
        "Resolved truncated issue ID",
      );
      return match.id;
    }
  }

  return null;
}
