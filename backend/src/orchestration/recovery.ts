/**
 * Startup recovery for orphaned agent runs.
 * Cleans up runs that were interrupted by server restart.
 */
import * as agentRunRepo from "../db/repositories/agent-runs.js";
import * as log from "../logger.js";
import * as crew from "./crew.js";
import { postSystemComment } from "./spawner.js";
import * as dispatchQueue from "./dispatch-queue.js";
import {
  SERVER_RECOVERY_DELAY_MS as RECOVERY_DELAY_MS,
  PROCESS_GRACE_PERIOD_MS,
} from "../config/orchestration.js";

export { RECOVERY_DELAY_MS };

/**
 * Check if a process with the given PID is still alive.
 */
export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    log.logger.debug({ pid }, "Process is not alive");
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

    // Grace period before SIGKILL
    setTimeout(() => {
      if (isProcessAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
          log.logger.info({ pid }, "Sent SIGKILL to orphaned process");
        } catch {
          // Process may have exited
          log.logger.debug({ pid }, "SIGKILL failed — process already exited");
        }
      }
    }, PROCESS_GRACE_PERIOD_MS);
  } catch (err) {
    log.logger.warn({ pid, err }, "Failed to kill orphaned process");
  }
};

/**
 * Recover orphaned agent runs on startup.
 * Marks any "running" runs as "failed" and kills orphaned processes.
 * Also recovers the dispatch queue from the database.
 */
export const recoverOnStartup = (): void => {
  const orphanedRuns = agentRunRepo.listRunningAgentRuns();

  if (orphanedRuns.length === 0) {
    log.logger.info("MentionHandler startup recovery: no orphaned runs");
  } else {
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

    log.logger.info("MentionHandler startup recovery: orphaned runs processed");
  }

  // Recover the dispatch queue
  // Running runs already marked failed above; recoverQueue reports queued runs count
  const queueRecovery = dispatchQueue.recoverQueue();
  log.logger.info(
    {
      markedFailed: queueRecovery.markedFailed,
      queued: queueRecovery.queued,
    },
    "Dispatch queue recovered from database",
  );
};
