/**
 * Startup recovery for orphaned agent runs.
 * Cleans up runs that were interrupted by server restart and re-dispatches captains.
 */
import * as agentRunRepo from "../db/repositories/agent-runs.js";
import * as issueRepo from "../db/repositories/issues.js";
import * as projectRepo from "../db/repositories/projects.js";
import * as log from "../logger.js";
import * as dispatchQueue from "./queue.js";
import * as crew from "./crew.js";
import { getActiveProcessCount } from "./processes.js";
import { postSystemComment, spawnAgent } from "./spawner.js";

/** Delay before recovery to ensure server is fully initialized */
const RECOVERY_DELAY_MS = 2000;
/** Stagger delay between captain dispatches */
const DISPATCH_STAGGER_MS = 500;

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
 * Dispatch captain for recovered issues, respecting max_concurrency.
 */
export const dispatchCaptainsForRecovery = (issuesByProject: Map<string, Set<string>>): void => {
  log.logger.info("Starting captain dispatch for recovered issues");

  let dispatchIndex = 0;

  for (const [projectId, issueIds] of issuesByProject) {
    const project = projectRepo.getProject(projectId);
    if (!project) {
      log.logger.warn({ projectId }, "Project not found for recovery dispatch");
      continue;
    }

    // Get issues still in in_progress status (they need recovery)
    const issuesToDispatch: string[] = [];
    for (const issueId of issueIds) {
      const issue = issueRepo.getIssue(issueId);
      if (issue && issue.status === "in_progress") {
        issuesToDispatch.push(issueId);
      }
    }

    if (issuesToDispatch.length === 0) continue;

    log.logger.info(
      { projectId, issueCount: issuesToDispatch.length, maxConcurrency: project.max_concurrency },
      "Dispatching captains for recovered issues",
    );

    // Dispatch captains with staggered timing, respecting concurrency
    for (const issueId of issuesToDispatch) {
      const delay = dispatchIndex * DISPATCH_STAGGER_MS;
      dispatchIndex++;

      setTimeout(() => {
        const captain = crew.getCrewMember("captain");
        if (!captain) {
          log.logger.error({ issueId, projectId }, "Recovery failed: captain agent not found");
          return;
        }

        // Check current concurrency before dispatching
        const activeCount = getActiveProcessCount(projectId);
        if (activeCount >= project.max_concurrency) {
          // Queue the dispatch instead
          const position = dispatchQueue.enqueue({
            projectId,
            issueId,
            agentId: "captain",
            queuedAt: new Date(),
          });
          log.logger.info(
            { issueId, projectId, position },
            "Recovery captain dispatch queued (at concurrency limit)",
          );
          postSystemComment(
            issueId,
            projectId,
            `Recovery: captain queued (${position} ahead)`,
          );
          return;
        }

        // Spawn captain directly instead of posting a system comment
        // (system comments are ignored by the dispatch handler to prevent loops)
        postSystemComment(issueId, projectId, "Recovery: resuming work after server restart");

        spawnAgent(captain, issueId, projectId).catch((err) => {
          log.logger.error(
            { err, issueId, projectId },
            "Recovery captain spawn failed",
          );
          postSystemComment(
            issueId,
            projectId,
            `Recovery failed: ${err instanceof Error ? err.message : "unknown error"}`,
          );
        });

        log.logger.info({ issueId, projectId }, "Recovery captain dispatch triggered");
      }, delay);
    }
  }
};

/**
 * Recover orphaned agent runs on startup.
 * Marks any "running" runs as "failed", kills orphaned processes,
 * and re-dispatches captain for affected issues.
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

  // Track unique issues that need captain re-dispatch, grouped by project
  const issuesByProject = new Map<string, Set<string>>();

  for (const run of orphanedRuns) {
    // Kill orphaned process if still running
    if (run.pid) {
      killOrphanedProcess(run.pid);
    }

    // Mark run as failed
    agentRunRepo.markRunFailed(run.id);

    const agent = crew.getCrewMember(run.agent_id);
    const agentName = agent?.name ?? run.agent_id;

    // Only post comment and track for captain re-dispatch if there's an issue
    if (run.issue_id) {
      postSystemComment(
        run.issue_id,
        run.project_id,
        `Agent run interrupted by server restart (${agentName})`,
      );

      // Track issue for captain re-dispatch
      if (!issuesByProject.has(run.project_id)) {
        issuesByProject.set(run.project_id, new Set());
      }
      issuesByProject.get(run.project_id)!.add(run.issue_id);
    }

    log.logger.info(
      { runId: run.id, agentId: run.agent_id, issueId: run.issue_id, pid: run.pid },
      "Marked orphaned run as failed",
    );
  }

  // Schedule captain re-dispatch after server is fully initialized
  if (issuesByProject.size > 0) {
    setTimeout(() => {
      dispatchCaptainsForRecovery(issuesByProject);
    }, RECOVERY_DELAY_MS);
  }

  log.logger.info("MentionHandler startup recovery: orphaned runs processed, captain dispatch scheduled");
};
