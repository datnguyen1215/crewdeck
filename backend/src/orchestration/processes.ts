/**
 * Active process tracking for agent orchestration.
 * Maintains a map of running agent processes with their metadata.
 */
import { type ChildProcess } from "node:child_process";

export interface ActiveProcess {
  pid: number;
  process: ChildProcess;
  projectId: string;
  issueId: string | null;
  agentId: string;
  agentRunId: string;
  timer: ReturnType<typeof setTimeout>;
}

export const activeProcesses = new Map<number, ActiveProcess>();

/**
 * Set of agent+issue pairs currently in the process of spawning.
 * Used to prevent race conditions where two events try to spawn the same agent
 * on the same issue simultaneously before the process is registered in activeProcesses.
 */
const pendingSpawns = new Set<string>();

/**
 * Generate a key for tracking pending spawns.
 */
const getPendingKey = (agentId: string, issueId: string): string => {
  return `${agentId}:${issueId}`;
};

/**
 * Count active processes for a project.
 * @param {string} projectId - Project to count for
 * @returns {number} Number of active processes
 */
export const getActiveProcessCount = (projectId: string): number => {
  let count = 0;
  for (const p of activeProcesses.values())
    if (p.projectId === projectId) count++;
  return count;
};

/**
 * Check if an issue has any active processes.
 * @param {string} issueId - Issue to check
 * @param {string} [excludeAgentId] - Agent ID to exclude from the check
 * @returns {boolean} True if processes are running
 */
export const hasActiveProcesses = (issueId: string, excludeAgentId?: string): boolean => {
  for (const p of activeProcesses.values()) {
    if (p.issueId === issueId && p.agentId !== excludeAgentId) return true;
  }
  return false;
};

/**
 * Check if a specific agent already has an active process for an issue.
 * Also checks the pending spawns set to prevent race conditions.
 * @param {string} agentId - Agent to check
 * @param {string} issueId - Issue to check
 * @returns {boolean} True if the agent is already running or pending for this issue
 */
export const hasActiveAgentProcess = (agentId: string, issueId: string): boolean => {
  // Check pending spawns first
  if (pendingSpawns.has(getPendingKey(agentId, issueId))) return true;

  // Check active processes
  for (const p of activeProcesses.values())
    if (p.agentId === agentId && p.issueId === issueId) return true;
  return false;
};

/**
 * Mark an agent+issue pair as pending spawn.
 * Returns true if successfully marked (not already pending), false if already pending.
 * @param {string} agentId - Agent ID
 * @param {string} issueId - Issue ID
 * @returns {boolean} True if marked as pending, false if already pending
 */
export const markPendingSpawn = (agentId: string, issueId: string): boolean => {
  const key = getPendingKey(agentId, issueId);
  if (pendingSpawns.has(key)) return false;
  pendingSpawns.add(key);
  return true;
};

/**
 * Clear pending spawn marker for an agent+issue pair.
 * @param {string} agentId - Agent ID
 * @param {string} issueId - Issue ID
 */
export const clearPendingSpawn = (agentId: string, issueId: string): void => {
  pendingSpawns.delete(getPendingKey(agentId, issueId));
};
