/**
 * Startup recovery for orphaned agent runs.
 * Cleans up runs that were interrupted by server restart.
 */
import * as agentRunRepo from "../db/repositories/agent-runs.js";
import * as log from "../logger.js";
import * as crew from "./crew.js";
import { postSystemComment } from "./spawner.js";

/** Delay before recovery to ensure server is fully initialized */
export const RECOVERY_DELAY_MS = 2000;

/**
 * Check if a process with the given PID is still alive.
 */
export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Kill a process by PID if it's still alive.
 */
export const killOrphanedProcess = (pid: number): void => {
  if (!isProcessAlive(pid)) return;

  try {
    process.kill(pid, "SIGTERM");
    log.logger.info({ pid }, "Sent SIGTERM to orphaned process");

    // Give it 5 seconds, then SIGKILL
    setTimeout(() => {
      if (isProcessAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
          log.logger.info({ pid }, "Sent SIGKILL to orphaned process");
        } catch {
          // Process may have exited
        }
      }
    }, 5000);
  } catch (err) {
    log.logger.warn({ pid, err }, "Failed to kill orphaned process");
  }
};

/**
 * Recover orphaned agent runs on startup.
 * Marks any "running" runs as "failed" and kills orphaned processes.
 */
export const recoverOnStartup = (): void => {
  const orphanedRuns = agentRunRepo.listRunningAgentRuns();

  if (orphanedRuns.length === 0) {
    log.logger.info("MentionHandler startup recovery: no orphaned runs");
    return;
  }

  log.logger.info(
    { count: orphanedRuns.length },
    "MentionHandler startup recovery: processing orphaned runs",
  );

  for (const run of orphanedRuns) {
    // Kill orphaned process if still running
    if (run.pid) {
      killOrphanedProcess(run.pid);
    }

    // Mark run as failed
    agentRunRepo.markRunFailed(run.id);

    const agent = crew.getCrewMember(run.agent_id);
    const agentName = agent?.name ?? run.agent_id;

    // Only post comment if there's an issue
    if (run.issue_id) {
      postSystemComment(
        run.issue_id,
        run.project_id,
        `Agent run interrupted by server restart (${agentName})`,
      );
    }

    log.logger.info(
      {
        runId: run.id,
        agentId: run.agent_id,
        issueId: run.issue_id,
        pid: run.pid,
      },
      "Marked orphaned run as failed",
    );
  }

  log.logger.info(
    "MentionHandler startup recovery: orphaned runs processed",
  );
};
