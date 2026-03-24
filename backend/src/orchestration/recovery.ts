/**
 * Startup recovery for orphaned agent runs.
 * Cleans up runs that were interrupted by server restart and emits recovery events
 * for Admiral to handle.
 */
import * as agentRunRepo from "../db/repositories/agent-runs.js";
import * as issueRepo from "../db/repositories/issues.js";
import * as log from "../logger.js";
import * as crew from "./crew.js";
import { eventBus } from "../events/bus.js";
import { postSystemComment } from "./spawner.js";

/** Delay before recovery to ensure server is fully initialized */
const RECOVERY_DELAY_MS = 2000;
/** Stagger delay between recovery events */
const RECOVERY_STAGGER_MS = 500;

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

interface RecoveryItem {
  projectId: string;
  issueId: string;
  agentId: string;
}

/**
 * Emit recovery events for issues that need attention after server restart.
 * Admiral listens to these events and decides how to proceed.
 */
export const emitRecoveryEvents = (items: RecoveryItem[]): void => {
  log.logger.info({ count: items.length }, "Emitting recovery events for orphaned issues");

  let eventIndex = 0;

  for (const item of items) {
    const delay = eventIndex * RECOVERY_STAGGER_MS;
    eventIndex++;

    setTimeout(() => {
      const issue = issueRepo.getIssue(item.issueId);
      if (!issue || issue.status !== "in_progress") {
        // Issue no longer needs recovery
        return;
      }

      postSystemComment(item.issueId, item.projectId, "Recovery: resuming work after server restart");

      eventBus.emit("run.recovered", {
        project_id: item.projectId,
        issue_id: item.issueId,
        failed_agent_id: item.agentId,
      });

      log.logger.info(
        { issueId: item.issueId, projectId: item.projectId, agentId: item.agentId },
        "Recovery event emitted",
      );
    }, delay);
  }
};

/**
 * Recover orphaned agent runs on startup.
 * Marks any "running" runs as "failed", kills orphaned processes,
 * and emits recovery events for Admiral to handle.
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

  // Track unique issues that need recovery (dedupe by issueId)
  const recoveryItems = new Map<string, RecoveryItem>();

  for (const run of orphanedRuns) {
    // Kill orphaned process if still running
    if (run.pid) {
      killOrphanedProcess(run.pid);
    }

    // Mark run as failed
    agentRunRepo.markRunFailed(run.id);

    const agent = crew.getCrewMember(run.agent_id);
    const agentName = agent?.name ?? run.agent_id;

    // Only post comment and track for recovery if there's an issue
    if (run.issue_id) {
      postSystemComment(
        run.issue_id,
        run.project_id,
        `Agent run interrupted by server restart (${agentName})`,
      );

      // Track issue for recovery (only keep one per issue)
      if (!recoveryItems.has(run.issue_id)) {
        recoveryItems.set(run.issue_id, {
          projectId: run.project_id,
          issueId: run.issue_id,
          agentId: run.agent_id,
        });
      }
    }

    log.logger.info(
      { runId: run.id, agentId: run.agent_id, issueId: run.issue_id, pid: run.pid },
      "Marked orphaned run as failed",
    );
  }

  // Schedule recovery events after server is fully initialized
  if (recoveryItems.size > 0) {
    setTimeout(() => {
      emitRecoveryEvents(Array.from(recoveryItems.values()));
    }, RECOVERY_DELAY_MS);
  }

  log.logger.info("MentionHandler startup recovery: orphaned runs processed, recovery events scheduled");
};
