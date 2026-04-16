/**
 * Supervisor Service
 *
 * Manages per-issue Supervisors — subscribing to events, batching them,
 * and invoking the Supervisor LLM agent to process each issue's lifecycle.
 *
 * Mirrors monitor-service.ts but is scoped per-issue instead of per-project.
 */
import { eventBus } from "../../events/bus.js";
import { logger } from "../../logger.js";
import { getProject, listProjects } from "../../db/repositories/projects.js";
import { listIssues } from "../../db/repositories/issues.js";
import * as agentSessionRepo from "../../db/repositories/agent-sessions.js";
import { isIssuePaused } from "../../services/issue-service.js";
import {
  enqueue,
  tryAcquire,
  release,
  drain,
  hasPending,
} from "../captain/queue.js";
import { processSupervisorWithLLM } from "./supervisor-agent.js";
import { RECOVERY_DELAY_MS } from "../recovery.js";
import {
  EVENT_BATCHING_WINDOW_MS,
  STARTUP_BUFFER_MS,
} from "../../config/orchestration.js";
import type { CaptainEvent } from "../captain/queue.js";
import type { EventMap } from "../../events/types.js";

// Queue namespace prefix for supervisor queues (per-issue)
const SUPERVISOR_PREFIX = "supervisor:";

// Track per-issue event subscriptions (unsubscribe functions)
const issueSubscriptions = new Map<string, () => void>();

/** Returns true if a Supervisor is currently active (subscribed) for the given issue. */
export function isSupervisorActive(issueId: string): boolean {
  return issueSubscriptions.has(issueId);
}

// Per-issue batch timers
const batchTimers = new Map<string, NodeJS.Timeout>();

function queueKey(issueId: string): string {
  return `${SUPERVISOR_PREFIX}${issueId}`;
}

/**
 * Queue an event and trigger processing after a batching window.
 */
async function queueAndProcess(
  event: CaptainEvent,
  issueId: string,
  projectId: string,
): Promise<void> {
  const key = queueKey(issueId);

  enqueue({ ...event, projectId: key });

  if (batchTimers.has(issueId)) {
    logger.debug(
      { issueId, eventType: event.type },
      "Supervisor: Event queued, batch timer already running",
    );
    return;
  }

  const timer = setTimeout(() => {
    batchTimers.delete(issueId);
    processBatch(issueId, projectId, key).catch((err) => {
      logger.error({ err, issueId }, "Supervisor: Batch processing failed");
    });
  }, EVENT_BATCHING_WINDOW_MS);

  batchTimers.set(issueId, timer);
  logger.debug({ issueId, eventType: event.type }, "Supervisor: Started batch timer");
}

/**
 * Process the event batch after the batching window closes.
 */
async function processBatch(
  issueId: string,
  projectId: string,
  key: string,
): Promise<void> {
  if (!tryAcquire(key)) {
    logger.debug({ issueId }, "Supervisor: Lock held, rescheduling batch");
    const timer = setTimeout(() => {
      batchTimers.delete(issueId);
      processBatch(issueId, projectId, key).catch((err) => {
        logger.error({ err, issueId }, "Supervisor: Rescheduled batch failed");
      });
    }, EVENT_BATCHING_WINDOW_MS);
    batchTimers.set(issueId, timer);
    return;
  }

  try {
    await processQueue(issueId, projectId, key);
  } finally {
    release(key);
  }
}

/**
 * Process all pending events in the queue for an issue.
 */
async function processQueue(
  issueId: string,
  projectId: string,
  key: string,
): Promise<void> {
  while (hasPending(key)) {
    const events = drain(key).map((e) => ({
      ...e,
      projectId, // restore original projectId
    }));
    if (events.length === 0) break;

    logger.info(
      { issueId, projectId, eventCount: events.length },
      "Supervisor: Processing event batch",
    );

    try {
      await processSupervisorWithLLM(issueId, projectId, events);
    } catch (err) {
      logger.error({ err, issueId }, "Supervisor: Failed to process events");
    }
  }
}

type AnyData = Record<string, unknown>;

const notIssuePaused = (issueId: string): boolean => !isIssuePaused(issueId);

const userAuthorOnly = (data: AnyData): boolean =>
  (data.comment as AnyData)?.author_type === "user";

// Non-done statuses that Supervisor cares about
const NON_DONE_STATUSES = new Set([
  "open",
  "in_progress",
  "pr_created",
  "pr_ready_to_merge",
  "pr_conflict",
  "pr_failed_actions",
]);

/**
 * Subscribe to all events relevant to a specific issue.
 * Returns an unsubscribe function.
 */
function subscribeToIssueEvents(issueId: string, projectId: string): () => void {
  const handlers: Array<{ eventType: string; handler: (data: AnyData) => void }> = [];

  function makeHandler(
    eventType: string,
    getIssueId: (data: AnyData) => string | null | undefined,
    filter?: (data: AnyData) => boolean,
  ) {
    const handler = (data: AnyData) => {
      if (getIssueId(data) !== issueId) return;
      if (!notIssuePaused(issueId)) return;
      if (filter && !filter(data)) return;

      queueAndProcess(
        { type: eventType as CaptainEvent["type"], projectId, timestamp: new Date(), data },
        issueId,
        projectId,
      ).catch((err) => {
        logger.error({ err, issueId }, `Supervisor: Failed to queue ${eventType}`);
      });
    };
    handlers.push({ eventType, handler });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventBus.on(eventType as keyof EventMap, handler as any);
  }

  // run.completed triggers for all agent completions on this issue (engineer, inspector, docs,
  // librarian) — this is intentional, Supervisor decides what to do next based on which agent
  // completed. Filter out captain and supervisor self-completions to prevent loops.
  makeHandler(
    "run.completed",
    (d) => (d as AnyData).issue_id as string | null,
    (d) => {
      const agentId = (d as AnyData).agent_id as string;
      return agentId !== "captain" && agentId !== "supervisor";
    },
  );
  // pr.status_changed does not carry issue_id — skip if we can't correlate to this issue.
  // The event payload only has pr_id and project_id; without a PR→issue lookup we cannot
  // reliably route it to the correct Supervisor. Leave unhandled until the event carries
  // issue_id or a lookup is added.
  // When an issue transitions to done, stop the Supervisor to clean up the subscription.
  const doneHandler = (data: AnyData) => {
    if ((data.issue_id as string) !== issueId) return;
    if ((data.to as string) === "done") {
      logger.info({ issueId }, "Supervisor: Issue done, stopping Supervisor");
      stopSupervisorForIssue(issueId);
    }
  };
  handlers.push({ eventType: "issue.status_changed", handler: doneHandler });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventBus.on("issue.status_changed" as keyof EventMap, doneHandler as any);

  makeHandler(
    "issue.status_changed",
    (d) => (d as AnyData).issue_id as string | null,
    // Only non-done status changes trigger the LLM
    (d) => {
      const to = (d as AnyData).to as string;
      return NON_DONE_STATUSES.has(to);
    },
  );
  makeHandler(
    "comment.added",
    (d) => ((d as AnyData).comment as AnyData)?.issue_id as string | null,
    userAuthorOnly,
  );
  makeHandler("issue.approved_to_merge", (d) => (d as AnyData).issue_id as string | null);

  return () => {
    for (const { eventType, handler } of handlers) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventBus.off(eventType as keyof EventMap, handler as any);
    }
  };
}

/**
 * Start Supervisor for a specific issue.
 * Subscribes to issue events and emits a startup scan.
 */
export function startSupervisorForIssue(issueId: string, projectId: string): void {
  if (issueSubscriptions.has(issueId)) {
    logger.debug({ issueId }, "Supervisor already running for this issue");
    return;
  }

  const project = getProject(projectId);
  if (!project) {
    logger.warn({ projectId, issueId }, "Supervisor: Project not found");
    return;
  }

  const unsubscribe = subscribeToIssueEvents(issueId, projectId);
  issueSubscriptions.set(issueId, unsubscribe);

  logger.info({ issueId, projectId }, "Supervisor started for issue");
}

/**
 * Stop Supervisor for a specific issue.
 * Unsubscribes from events and cancels pending timers.
 */
export function stopSupervisorForIssue(issueId: string): void {
  const unsubscribe = issueSubscriptions.get(issueId);
  if (unsubscribe) {
    unsubscribe();
    issueSubscriptions.delete(issueId);
  }

  const timer = batchTimers.get(issueId);
  if (timer) {
    clearTimeout(timer);
    batchTimers.delete(issueId);
  }

  logger.info({ issueId }, "Supervisor stopped for issue");
}

/**
 * Initialize Supervisor service on server boot.
 * Scans agent_sessions table for existing Supervisor sessions and resumes each.
 * Also starts Supervisors for all non-done issues that have sessions.
 */
export function initSupervisorService(): void {
  // Delay startup to allow recovery cleanup to complete first.
  // listProjects() is called inside the callback so it reads fresh data at scan time.
  setTimeout(() => {
    const projects = listProjects();
    let issueCount = 0;

    for (const project of projects) {
      // Find all non-done issues for this project
      const issues = listIssues(project.id, {
        status: [
          "open",
          "in_progress",
          "pr_created",
          "pr_ready_to_merge",
          "pr_conflict",
          "pr_failed_actions",
        ],
      });

      for (const issue of issues) {
        // Only re-subscribe Supervisors that had an active session before restart.
        // This is intentional lazy recovery: no proactive LLM call is made on boot.
        // The Supervisor will invoke the LLM when the next event arrives for its issue.
        // Prior in-flight state is not recovered — the next event triggers a fresh invocation.
        const session = agentSessionRepo.getSession(project.id, issue.id, "supervisor");
        if (session) {
          startSupervisorForIssue(issue.id, project.id);
          issueCount++;
        }
      }
    }

    logger.info(
      { projectCount: projects.length, issueCount },
      "Supervisor service initialized",
    );
  }, RECOVERY_DELAY_MS + STARTUP_BUFFER_MS);
}

/**
 * Shutdown Supervisor service — stop all active Supervisors.
 */
export function shutdownSupervisorService(): void {
  for (const [issueId, unsubscribe] of issueSubscriptions) {
    unsubscribe();
    logger.debug({ issueId }, "Supervisor stopped");
  }
  issueSubscriptions.clear();

  for (const timer of batchTimers.values()) {
    clearTimeout(timer);
  }
  batchTimers.clear();

  logger.info("Supervisor service shutdown complete");
}
