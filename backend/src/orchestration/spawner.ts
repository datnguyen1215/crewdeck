/**
 * Agent spawning logic.
 * Handles process spawning, streaming output, and completion tracking.
 */
import fs from "node:fs";
import * as events from "../events/bus.js";
import * as agentProcess from "./process.js";
import * as agentPrompt from "./prompt.js";
import { toContainerPath } from "../utils/paths.js";
import * as agentWorktree from "./worktree.js";
import * as crew from "./crew.js";
import * as issueRepo from "../db/repositories/issues.js";
import * as commentRepo from "../db/repositories/comments.js";
import * as projectRepo from "../db/repositories/projects.js";
import * as agentRunRepo from "../db/repositories/agent-runs.js";
import { normalizeEvent } from "../services/event-normalizer.js";
import * as knowledgeRepo from "../db/repositories/knowledge.js";
import * as envVarRepo from "../db/repositories/environment-variables.js";
import * as repoRepo from "../db/repositories/repos.js";
import * as issuePRRepo from "../db/repositories/issue-prs.js";
import * as database from "../db/index.js";
import * as log from "../logger.js";
import * as dispatchQueue from "./dispatch-queue.js";
import {
  activeProcesses,
  getActiveProcessCount,
  clearPendingSpawn,
  type ActiveProcess,
} from "./processes.js";
import { config } from "../config.js";
import { markAgentCompleted } from "./batch.js";
import {
  createGitSshEnv,
  cleanupSshKey,
  getProjectCredentials,
} from "../utils/git-auth.js";
import * as agentConfigRepo from "../db/repositories/agent-config.js";
import type { Agent, AgentRun, AgentRunStatus } from "../types/entities.js";
import {
  IssueStatus,
  PR_RELATED_ISSUE_STATUSES,
  PRStatus,
} from "../constants/statuses.js";
import type { IssueStatusValue } from "../constants/statuses.js";

const DEFAULT_MAX_CHAIN_DEPTH = 20;
const DEFAULT_AGENT_TIMEOUT_MINUTES = 10;

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
 * Assemble environment dict with CREWDECK_* vars, SSH credentials, and GH_TOKEN.
 * Returns env record, optional SSH key path for cleanup, and the resolved creds.
 * Pass creds explicitly to avoid a redundant getProjectCredentials() call.
 */
function buildAgentEnvironment(
  projectId: string,
  agentId: string,
  issueId: string,
  creds?: ReturnType<typeof getProjectCredentials>,
): {
  env: Record<string, string>;
  sshKeyPath?: string;
  creds: ReturnType<typeof getProjectCredentials>;
} {
  const envVars = envVarRepo.getEnvironmentVariablesMap(projectId);
  const env: Record<string, string> = {
    ...envVars,
    CREWDECK_API_URL: `http://localhost:${process.env.PORT || "9381"}`,
    CREWDECK_PROJECT_ID: projectId,
    CREWDECK_AGENT_ID: agentId,
    CREWDECK_ISSUE_ID: issueId,
  };

  let sshKeyPath: string | undefined;
  const resolvedCreds = creds ?? getProjectCredentials(projectId);
  if (resolvedCreds) {
    const ssh = createGitSshEnv(resolvedCreds.sshPrivateKey);
    sshKeyPath = ssh.keyPath;
    Object.assign(env, ssh.env);
    env.GH_TOKEN = resolvedCreds.ghToken;
  }

  return { env, sshKeyPath, creds: resolvedCreds };
}

/**
 * Check if worktree exists on disk; if not, re-fetch repo and recreate.
 * Returns the resolved worktree path (or null if no repo).
 * Accepts optional creds to avoid a redundant getProjectCredentials() call.
 */
async function validateOrRecreateWorktree(
  issueId: string,
  projectId: string,
  currentWorktreePath: string | null,
  creds?: ReturnType<typeof getProjectCredentials>,
): Promise<string | null> {
  const repo = repoRepo.listRepos(projectId)[0] ?? null;
  const resolvedCreds = creds ?? getProjectCredentials(projectId);
  let worktreePath = currentWorktreePath;

  if (worktreePath && !fs.existsSync(worktreePath)) {
    log.logger.info(
      { worktreePath, issueId },
      "Worktree path missing, will re-create",
    );
    worktreePath = null;
  }

  if (!worktreePath && repo) {
    const freshIssue = issueRepo.getIssue(issueId)!;
    const result = await agentWorktree.createWorktree(
      repo as any,
      freshIssue,
      repo.default_branch,
      resolvedCreds?.sshPrivateKey,
    );
    worktreePath = result.path;
  }

  return worktreePath;
}

/**
 * Fetch comments + knowledge and build agent prompt.
 */
function buildAgentPrompt(
  issueId: string,
  projectId: string,
  worktreePath: string | null,
  agentId: string,
): string {
  const repo = repoRepo.listRepos(projectId)[0] ?? null;
  const comments = commentRepo.listComments(issueId);
  const projectKnowledge = knowledgeRepo.listByProject(projectId);

  return agentPrompt.buildPrompt({
    issue: issueRepo.getIssue(issueId)!,
    comments,
    repo,
    worktreePath: worktreePath ?? ".",
    agentId,
    projectKnowledge,
  });
}

/**
 * Regress DONE/OPEN/PR status back to IN_PROGRESS when work restarts.
 */
function regressIssueStatus(
  issueId: string,
  projectId: string,
  currentStatus: string,
): void {
  if (
    currentStatus === IssueStatus.DONE ||
    currentStatus === IssueStatus.OPEN ||
    PR_RELATED_ISSUE_STATUSES.has(currentStatus as IssueStatusValue)
  ) {
    issueRepo.updateIssue(issueId, { status: IssueStatus.IN_PROGRESS });
    events.eventBus.emit("issue.status_changed", {
      issue_id: issueId,
      project_id: projectId,
      from: currentStatus,
      to: IssueStatus.IN_PROGRESS,
      actor_type: "system",
    });
  }
}

/**
 * Check for merged PRs on DONE issues. Returns true if dispatch should be rejected.
 */
function validateNoMergedPR(
  issueId: string,
  projectId: string,
  issueStatus: string,
): boolean {
  if (issueStatus !== IssueStatus.DONE) return false;

  const prs = issuePRRepo.listIssuePRs(issueId);
  const mergedPR = prs.find((pr) => pr.status === PRStatus.MERGED);
  if (mergedPR) {
    postSystemComment(
      issueId,
      projectId,
      `Dispatch rejected: issue already has a merged PR (#${mergedPR.pr_number})`,
    );
    return true;
  }
  return false;
}

/**
 * Check canSpawn guards: paused issue, missing project/issue.
 * Returns true if spawn should be aborted.
 */
function validateCanSpawn(
  agent: Agent,
  issueId: string,
  projectId: string,
): boolean {
  if (issueRepo.pausedIssues.has(issueId) || issueRepo.isIssuePaused(issueId)) {
    log.logger.warn(
      { agentId: agent.id, issueId, reason: "issue_paused" },
      "Spawn blocked: issue is paused",
    );
    clearPendingSpawn(agent.id, issueId);
    return true;
  }

  if (!projectRepo.getProject(projectId)) {
    clearPendingSpawn(agent.id, issueId);
    return true;
  }

  if (!issueRepo.getIssue(issueId)) {
    clearPendingSpawn(agent.id, issueId);
    return true;
  }

  return false;
}

/**
 * Handle global or project-level concurrency queuing.
 * Returns true if the run was queued (spawn should be aborted).
 */
function handleConcurrencyQueuing(
  agent: Agent,
  issueId: string,
  projectId: string,
  limitReached: boolean,
  label: string,
): boolean {
  if (!limitReached) return false;

  if (dispatchQueue.isAgentActive(projectId, issueId, agent.id)) {
    postSystemComment(
      issueId,
      projectId,
      `Agent ${agent.name} is already queued or running`,
    );
    database.db
      .prepare("UPDATE Issue SET chain_depth = chain_depth - 1 WHERE id = ?")
      .run(issueId);
    clearPendingSpawn(agent.id, issueId);
    return true;
  }

  dispatchQueue.enqueueRun(projectId, issueId, agent.id);
  const position = dispatchQueue.getQueuePosition(projectId, issueId, agent.id);
  const ahead = position;
  postSystemComment(
    issueId,
    projectId,
    `Agent ${agent.name} queued${label ? ` (${label})` : ""}${ahead > 0 ? ` - ${ahead} agent${ahead === 1 ? "" : "s"} ahead` : " (next in line)"}`,
  );
  events.eventBus.emit("dispatch.queued", {
    project_id: projectId,
    issue_id: issueId,
    agent_id: agent.id,
    position,
  });
  database.db
    .prepare("UPDATE Issue SET chain_depth = chain_depth - 1 WHERE id = ?")
    .run(issueId);
  clearPendingSpawn(agent.id, issueId);
  return true;
}

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
async function spawnAndTrack(opts: {
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
    }, 5000);
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

/**
 * Spawn an agent process for a mentioned agent on an issue.
 * Handles chain depth, concurrency, worktree creation, and process lifecycle.
 */
export const spawnAgent = async (
  agent: Agent,
  issueId: string,
  projectId: string,
  commentAuthorAgentId?: string,
  options?: { batchTriggered?: boolean; isRetry?: boolean },
): Promise<void> => {
  if (validateCanSpawn(agent, issueId, projectId)) return;

  const project = projectRepo.getProject(projectId)!;
  const issue = issueRepo.getIssue(issueId)!;

  const maxChainDepth = project.max_chain_depth ?? DEFAULT_MAX_CHAIN_DEPTH;

  // Atomic check-and-increment to prevent concurrent mentions from exceeding the limit.
  // If chain_depth is already at MAX, the UPDATE matches zero rows and we reject.
  const incResult = database.db
    .prepare(
      "UPDATE Issue SET chain_depth = chain_depth + 1 WHERE id = ? AND chain_depth < ?",
    )
    .run(issueId, maxChainDepth);

  if (incResult.changes === 0) {
    postSystemComment(
      issueId,
      projectId,
      `Chain depth limit reached (${maxChainDepth}). No more agents can be spawned on this issue. Use the "Reset chain depth" button to continue.`,
    );
    events.eventBus.emit("mention.chain_depth_reached", {
      issue_id: issueId,
      project_id: projectId,
    });
    clearPendingSpawn(agent.id, issueId);
    return;
  }

  // Check global concurrency limit
  if (
    handleConcurrencyQueuing(
      agent,
      issueId,
      projectId,
      agentRunRepo.countRunningGlobal() >= config.maxAgents,
      "global limit reached",
    )
  ) {
    return;
  }

  // Check project concurrency limit
  if (
    handleConcurrencyQueuing(
      agent,
      issueId,
      projectId,
      getActiveProcessCount(projectId) >= project.max_concurrency,
      "",
    )
  ) {
    return;
  }

  // Guard against dispatching to issues with merged PRs
  if (validateNoMergedPR(issueId, projectId, issue.status)) {
    database.db
      .prepare("UPDATE Issue SET chain_depth = chain_depth - 1 WHERE id = ?")
      .run(issueId);
    clearPendingSpawn(agent.id, issueId);
    return;
  }

  regressIssueStatus(issueId, projectId, issue.status);

  const { env, sshKeyPath, creds } = buildAgentEnvironment(
    projectId,
    agent.id,
    issueId,
  );

  const worktreePath = await validateOrRecreateWorktree(
    issueId,
    projectId,
    issue.worktree_path,
    creds,
  );

  const prompt = buildAgentPrompt(issueId, projectId, worktreePath, agent.id);

  const timeoutMinutes =
    project.agent_timeout_minutes ?? DEFAULT_AGENT_TIMEOUT_MINUTES;
  const model = agentConfigRepo.resolveModel(agent.id);

  await spawnAndTrack({
    agent,
    projectId,
    issueId,
    prompt,
    workdir: worktreePath ?? ".",
    env,
    timeoutMinutes,
    logLabel: "Agent",
    model,
    onComplete: sshKeyPath ? () => cleanupSshKey(sshKeyPath!) : undefined,
  });
};

/**
 * Execute a queued run by spawning the agent process.
 * Called by the queue drainer when a slot becomes available.
 */
export const executeQueuedRun = async (run: AgentRun): Promise<void> => {
  const { project_id: projectId, issue_id: issueId, agent_id: agentId } = run;

  if (!issueId) {
    log.logger.error({ runId: run.id }, "Cannot execute run without issue_id");
    agentRunRepo.updateAgentRun(run.id, { status: "failed" });
    return;
  }

  const project = projectRepo.getProject(projectId);
  if (!project) {
    log.logger.error({ projectId, runId: run.id }, "Project not found");
    agentRunRepo.updateAgentRun(run.id, { status: "failed" });
    return;
  }

  const issue = issueRepo.getIssue(issueId);
  if (!issue) {
    log.logger.error({ issueId, runId: run.id }, "Issue not found");
    agentRunRepo.updateAgentRun(run.id, { status: "failed" });
    return;
  }

  if (issueRepo.pausedIssues.has(issueId)) {
    log.logger.warn(
      { agentId, issueId, reason: "issue_paused" },
      "Queued spawn blocked: issue is paused",
    );
    agentRunRepo.updateAgentRun(run.id, { status: "failed" });
    return;
  }

  const agent = crew.getCrewMember(agentId);
  if (!agent) {
    log.logger.error({ agentId, runId: run.id }, "Agent not found");
    agentRunRepo.updateAgentRun(run.id, { status: "failed" });
    return;
  }

  if (validateNoMergedPR(issueId, projectId, issue.status)) {
    agentRunRepo.updateAgentRun(run.id, { status: "failed" });
    return;
  }

  // Re-increment chain_depth (was rolled back when queued)
  database.db
    .prepare("UPDATE Issue SET chain_depth = chain_depth + 1 WHERE id = ?")
    .run(issueId);

  postSystemComment(
    issueId,
    projectId,
    `Agent ${agent.name} dequeued, spawning now`,
  );

  events.eventBus.emit("dispatch.dequeued", {
    project_id: projectId,
    issue_id: issueId,
    agent_id: agentId,
  });

  regressIssueStatus(issueId, projectId, issue.status);

  const { env, sshKeyPath, creds } = buildAgentEnvironment(
    projectId,
    agent.id,
    issueId,
  );

  const worktreePath = await validateOrRecreateWorktree(
    issueId,
    projectId,
    issue.worktree_path,
    creds,
  );

  const prompt = buildAgentPrompt(issueId, projectId, worktreePath, agent.id);
  const timeoutMinutes =
    project.agent_timeout_minutes ?? DEFAULT_AGENT_TIMEOUT_MINUTES;
  const model = agentConfigRepo.resolveModel(agent.id);

  await spawnAndTrack({
    agent,
    projectId,
    issueId,
    prompt,
    workdir: worktreePath ?? ".",
    env,
    timeoutMinutes,
    logLabel: "Queued agent",
    model,
    existingRunId: run.id,
    onComplete: sshKeyPath ? () => cleanupSshKey(sshKeyPath!) : undefined,
  });
};

/**
 * Spawn a librarian scan without an issue.
 * Runs against the main repo, not a worktree.
 */
export const spawnScan = async (projectId: string): Promise<string> => {
  const project = projectRepo.getProject(projectId);
  if (!project) throw new Error("Project not found");

  const agent = crew.getCrewMember("librarian");
  if (!agent) throw new Error("Librarian agent not found");

  // Check concurrency limit (scans can't be queued since they have no issue)
  const activeCount = getActiveProcessCount(projectId);
  if (activeCount >= project.max_concurrency) {
    throw new Error(
      `Concurrency limit reached (${project.max_concurrency} agents running). Try again later.`,
    );
  }

  const repo = repoRepo.listRepos(projectId)[0] ?? null;
  const repoPath = repo ? toContainerPath(repo.local_path) : ".";

  const projectKnowledge = knowledgeRepo.listByProject(projectId);

  const prompt = agentPrompt.buildScanPrompt({
    repo,
    repoPath,
    projectKnowledge,
  });

  const envVars = envVarRepo.getEnvironmentVariablesMap(projectId);
  const env: Record<string, string> = {
    ...envVars,
    CREWDECK_API_URL: `http://localhost:${process.env.PORT || "9381"}`,
    CREWDECK_PROJECT_ID: projectId,
    CREWDECK_AGENT_ID: agent.id,
  };

  const timeoutMinutes =
    project.agent_timeout_minutes ?? DEFAULT_AGENT_TIMEOUT_MINUTES;

  const model = agentConfigRepo.resolveModel(agent.id);

  return spawnAndTrack({
    agent,
    projectId,
    issueId: null,
    prompt,
    workdir: repoPath,
    env,
    timeoutMinutes,
    logLabel: "Scan",
    model,
  });
};
