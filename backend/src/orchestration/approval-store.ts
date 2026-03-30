/**
 * In-memory approval flags for manual issue start and merge.
 *
 * When auto_start and auto_merge settings are OFF, the user can manually
 * approve specific issues for work or merge. These approvals are stored
 * in memory and cleared on server restart.
 *
 * Captain checks these flags alongside project settings:
 * - canStart = approvedToStart.has(issueId) || project.auto_start
 * - canMerge = approvedToMerge.has(issueId) || project.auto_merge
 */

/** Issue IDs approved for work (manual start via play button) */
export const approvedToStart = new Set<string>();

/** Issue IDs approved for merge (manual merge via merge button) */
export const approvedToMerge = new Set<string>();

/** Approve an issue to start work */
export function approveStart(issueId: string): void {
  approvedToStart.add(issueId);
}

/** Approve an issue for merge */
export function approveMerge(issueId: string): void {
  approvedToMerge.add(issueId);
}

/** Clear start approval (called after work begins) */
export function clearStartApproval(issueId: string): void {
  approvedToStart.delete(issueId);
}

/** Clear merge approval (called after merge completes) */
export function clearMergeApproval(issueId: string): void {
  approvedToMerge.delete(issueId);
}

/** Check if an issue is approved to start */
export function isApprovedToStart(issueId: string): boolean {
  return approvedToStart.has(issueId);
}

/** Check if an issue is approved to merge */
export function isApprovedToMerge(issueId: string): boolean {
  return approvedToMerge.has(issueId);
}

/** Clear all approvals (for testing or shutdown) */
export function clearAllApprovals(): void {
  approvedToStart.clear();
  approvedToMerge.clear();
}
