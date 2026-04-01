/**
 * Agent process lifecycle: posting system comments, streaming events, and spawn tracking.
 */
import * as events from "../events/bus.js";
import * as agentProcess from "./process.js";
import * as commentRepo from "../db/repositories/comments.js";
import * as agentRunRepo from "../db/repositories/agent-runs.js";
import { normalizeEvent } from "../services/event-normalizer.js";
import * as log from "../logger.js";
import {
  activeProcesses,
  clearPendingSpawn,
  type ActiveProcess,
} from "./processes.js";
import { markAgentCompleted } from "./batch.js";
import { PROCESS_GRACE_PERIOD_MS } from "../config/orchestration.js";
import type { Agent, AgentRun, AgentRunStatus } from "../types/entities.js";

/**
 * Post a system comment and emit comment.added.
 */
export const postSystemComment = (
  issueId: string,
  projectId: string,
  content: string,
  authorType = "system",
): void => {
  const comment = commentRepo.createComment(issueId, {
    content,
    author_type: authorType,
  });
  events.eventBus.emit("comment.added", { comment, project_id: projectId });
};

/**
 * Process streaming events from agent, persist to DB, and handle completion.
 */
export async function processAgentStream(
  result: Awaited<ReturnType<typeof agentProcess.spawnClaudeStream>>,
  agentRunId: string,
  projectId: string,
  issueId: string | null,
  agent: Agent,
  timer: ReturnType<typeof setTimeout>,
  timeoutState: { timedOut: boolean },
  timeoutMinutes: number,
): Promise<void> {
  const startTime = Date.now();
  let resultText = "";
  let cost: number | undefined;
  let hasEvents = false;

  // Stream events and persist
  for await (const event of result.events) {
    hasEvents = true;

    // Persist event to DB using raw event type from Claude CLI
    const savedEvent = agentRunRepo.createAgentRunEvent(
      agentRunId,
      event.type,
      event,
    );

    // Normalize event for frontend consumption and broadcast via WebSocket
    const normalized = normalizeEvent({
      id: savedEvent.id,
      agent_run_id: agentRunId,
      type: event.type,
      data: event,
      created_at: savedEvent.created_at,
    });

    events.eventBus.emit("run.event", {
      agent_run_id: agentRunId,
      project_id: projectId,
      event_id: savedEvent.id,
      type: normalized.type,
      data: normalized.data,
      created_at: savedEvent.created_at,
    });

    // Extract result info from final result event
    if (event.type === "result") {
      resultText = (event as any).result ?? "";
      cost = (event as any).cost_usd ?? (event as any).total_cost_usd;
    }
  }

  // Wait for process exit
  const { code } = await result.exitPromise;

  clearTimeout(timer);
  activeProcesses.delete(result.pid);

  const durationMs = Date.now() - startTime;
  const completedAt = new Date().toISOString();

  // Determine final status
  let status: AgentRunStatus;
  if (timeoutState.timedOut) {
    status = "timeout";
  } else if (code === 0) {
    status = "completed";
  } else {
    status = "failed";
  }

  // Update run record
  agentRunRepo.updateAgentRun(agentRunId, {
    status,
    exit_code: code,
    cost_usd: cost,
    duration_ms: durationMs,
    completed_at: completedAt,
  });

  // Emit completion event
  events.eventBus.emit("run.completed", {
    agent_run_id: agentRunId,
    project_id: projectId,
    issue_id: issueId,
    agent_id: agent.id,
    status,
    exit_code: code,
    cost_usd: cost ?? null,
    duration_ms: durationMs,
    completed_at: completedAt,
  });

  if (code === 0) {
    // Only post comment if there's an issue
    if (resultText && issueId) {
      const comment = commentRepo.createComment(issueId, {
        content: resultText,
        author_type: agent.id,
      });
      events.eventBus.emit("comment.added", { comment, project_id: projectId });
    }

    log.logger.info(
      {
        pid: result.pid,
        agent: agent.name,
        cost,
        durationMs,
        runId: agentRunId,
      },
      "Agent finished",
    );
  } else {
    if (issueId) {
      postSystemComment(
        issueId,
        projectId,
        `Agent ${agent.name} ${timeoutState.timedOut ? `timed out (${timeoutMinutes} min limit` : `crashed (exit code ${code}`}${hasEvents ? "" : ", no output"})`,
      );
    }
    log.logger.error(
      { pid: result.pid, code, agent: agent.name, runId: agentRunId },
      "Agent process failed",
    );
  }

  // Track batch completion (only for issue-bound runs)
  if (issueId) {
    markAgentCompleted(agent.id, issueId);
  }

  events.eventBus.emit("mention.completed", {
    project_id: projectId,
    issue_id: issueId,
    agent_id: agent.id,
    exit_code: code,
  });
}

/**
 * Shared spawn skeleton: creates (or reuses) an AgentRun, spawns the process,
 * sets up timeout, tracks in activeProcesses, emits events, and kicks off stream.
 * Pass existingRunId to reuse a pre-created run record (e.g. from executeQueuedRun).
 * Returns the AgentRun ID.
 */
export async function spawnAndTrack(opts: {
  agent: Agent;
  projectId: string;
  issueId: string | null;
  prompt: string;
  workdir: string;
  env: Record<string, string>;
  timeoutMinutes: number;
  logLabel: string;
  model?: string;
  existingRunId?: string;
  onComplete?: () => void;
}): Promise<string> {
  const {
    agent,
    projectId,
    issueId,
    prompt,
    workdir,
    env,
    timeoutMinutes,
    logLabel,
    model,
    existingRunId,
    onComplete,
  } = opts;

  // Use existing run record or create a new one
  const agentRun = existingRunId
    ? agentRunRepo.updateAgentRun(existingRunId, {
        status: "running",
        started_at: new Date().toISOString(),
      })!
    : agentRunRepo.createAgentRun({
        project_id: projectId,
        issue_id: issueId,
        agent_id: agent.id,
        status: "running",
      });

  let result: Awaited<ReturnType<typeof agentProcess.spawnClaudeStream>>;
  try {
    result = await agentProcess.spawnClaudeStream({
      prompt,
      systemPrompt: agent.system_prompt,
      workdir,
      env,
      model,
    });
  } catch (err) {
    agentRunRepo.updateAgentRun(agentRun.id, {
      status: "failed",
      completed_at: new Date().toISOString(),
    });
    // Clear pending spawn marker on failure
    if (issueId) {
      clearPendingSpawn(agent.id, issueId);
    }
    log.logger.error(
      { err, runId: agentRun.id, agent: agent.name },
      `${logLabel} spawn failed`,
    );
    onComplete?.();
    throw err;
  }

  // Update run with PID
  agentRunRepo.updateAgentRun(agentRun.id, { pid: result.pid });

  const timeoutMs = timeoutMinutes * 60 * 1000;
  const timeoutState = { timedOut: false };
  const timer = setTimeout(() => {
    timeoutState.timedOut = true;
    log.logger.warn(
      { pid: result.pid, agentId: agent.id, issueId },
      `${logLabel} process timed out`,
    );
    result.process.kill("SIGTERM");
    setTimeout(() => {
      if (!result.process.killed) result.process.kill("SIGKILL");
    }, PROCESS_GRACE_PERIOD_MS);
  }, timeoutMs);

  const entry: ActiveProcess = {
    pid: result.pid,
    process: result.process,
    projectId,
    issueId,
    agentId: agent.id,
    agentRunId: agentRun.id,
    timer,
  };
  activeProcesses.set(result.pid, entry);

  // Clear pending spawn marker now that process is registered
  if (issueId) {
    clearPendingSpawn(agent.id, issueId);
    events.eventBus.emit("mention.spawned", {
      project_id: projectId,
      issue_id: issueId,
      agent_id: agent.id,
      pid: result.pid,
    });
  }

  events.eventBus.emit("run.started", {
    agent_run_id: agentRun.id,
    project_id: projectId,
    issue_id: issueId,
    agent_id: agent.id,
    status: agentRun.status,
    started_at: agentRun.started_at,
  });

  log.logger.info(
    { pid: result.pid, agent: agent.name, issueId, runId: agentRun.id },
    `${logLabel} spawned`,
  );

  // Process streamed events (fire-and-forget)
  processAgentStream(
    result,
    agentRun.id,
    projectId,
    issueId,
    agent,
    timer,
    timeoutState,
    timeoutMinutes,
  )
    .catch((err) => {
      log.logger.error(
        { err, runId: agentRun.id },
        `Error processing ${logLabel.toLowerCase()} stream`,
      );

      // Clean up state on error
      clearTimeout(timer);
      activeProcesses.delete(result.pid);

      // Mark run as failed in DB
      agentRunRepo.updateAgentRun(agentRun.id, {
        status: "failed",
        completed_at: new Date().toISOString(),
      });

      // Emit completion event so queue can drain
      events.eventBus.emit("mention.completed", {
        project_id: projectId,
        issue_id: issueId,
        agent_id: agent.id,
        exit_code: 1,
      });

      // Post system comment if there's an issue
      if (issueId) {
        postSystemComment(
          issueId,
          projectId,
          `Agent ${agent.name} stream processing failed: ${err.message}`,
        );
      }
    })
    .finally(() => {
      onComplete?.();
    });

  return agentRun.id;
}
