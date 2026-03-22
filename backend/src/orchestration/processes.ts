/**
 * Active process tracking for agent orchestration.
 * Maintains a map of running agent processes with their metadata.
 */
import { type ChildProcess } from "node:child_process";

export interface ActiveProcess {
  pid: number;
  process: ChildProcess;
  projectId: string;
  issueId: string;
  agentId: string;
  agentRunId: string;
  timer: ReturnType<typeof setTimeout>;
}

export const activeProcesses = new Map<number, ActiveProcess>();

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
 * @param {string} agentId - Agent to check
 * @param {string} issueId - Issue to check
 * @returns {boolean} True if the agent is already running for this issue
 */
export const hasActiveAgentProcess = (agentId: string, issueId: string): boolean => {
  for (const p of activeProcesses.values())
    if (p.agentId === agentId && p.issueId === issueId) return true;
  return false;
};
