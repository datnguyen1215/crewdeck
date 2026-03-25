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
import * as knowledgeRepo from "../db/repositories/knowledge.js";
import * as database from "../db/index.js";
import * as log from "../logger.js";
import * as dispatchQueue from "./queue.js";
import {
  activeProcesses,
  getActiveProcessCount,
  type ActiveProcess,
} from "./processes.js";
import { markAgentCompleted } from "./batch.js";
import {
  createGitSshEnv,
  cleanupSshKey,
  getProjectCredentials,
} from "../utils/git-auth.js";
import type { Agent, AgentRunStatus } from "../types/entities.js";

const DEFAULT_MAX_CHAIN_DEPTH = 20;
const DEFAULT_AGENT_TIMEOUT_MINUTES = 10;

/**
 * Post a system comment and emit comment.added.
 * @param {string} issueId - Target issue
 * @param {string} projectId - Parent project
 * @param {string} content - Comment body
 */
export const postSystemComment = (
  issueId: string,
  projectId: string,
  content: string,
): void => {
  const comment = commentRepo.createComment(issueId, {
    content,
    author_type: "system",
  });
  events.eventBus.emit("comment.added", { comment, project_id: projectId });
};

/**
 * Get the first repo for a project.
 * Direct query to avoid circular dependency with repos repository.
 * @param {string} projectId - Project to look up
 * @returns {object|undefined} Repo row or undefined
 */
const getFirstRepo = (projectId: string) => {
  const row = database.db
    .prepare("SELECT * FROM Repo WHERE project_id = ? LIMIT 1")
    .get(projectId);
  return row as
    | {
        id: string;
        project_id: string;
        github_url: string;
        name: string;
        owner: string;
        local_path: string;
        default_branch: string;
      }
    | undefined;
};

/**
 * Load environment variables for a project as key-value pairs.
 * @param {string} projectId - Project to load vars for
 * @returns {Record<string, string>} Environment variable map
 */
const getEnvVars = (projectId: string): Record<string, string> => {
  const rows = database.db
    .prepare("SELECT key, value FROM EnvironmentVariable WHERE project_id = ?")
    .all(projectId) as { key: string; value: string }[];
  const env: Record<string, string> = {};
  for (const row of rows) env[row.key] = row.value;
  return env;
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
  options?: { batchTriggered?: boolean; isRetry?: boolean },
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

    // Broadcast via WebSocket
    events.eventBus.emit("run.event", {
      agent_run_id: agentRunId,
      project_id: projectId,
      event_id: savedEvent.id,
      type: event.type,
      data: event,
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
        author_type: "agent",
        author_id: agent.id,
      });
      events.eventBus.emit("comment.added", { comment, project_id: projectId });
    }

    // No system comment for successful completion — this info is in the activity log (run.completed event)

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
 * Spawn an agent process for a mentioned agent on an issue.
 * Handles chain depth, concurrency, worktree creation, and process lifecycle.
 * @param {Agent} agent - Agent to spawn
 * @param {string} issueId - Target issue
 * @param {string} projectId - Parent project
 * @param {string} [commentAuthorAgentId] - Author of the triggering comment
 * @param {object} [options] - Optional spawn options
 * @param {boolean} [options.batchTriggered] - Whether this spawn was triggered by batch completion
 * @param {boolean} [options.isRetry] - Whether this is a retry spawn (prevents infinite loops)
 */
export const spawnAgent = async (
  agent: Agent,
  issueId: string,
  projectId: string,
  commentAuthorAgentId?: string,
  options?: { batchTriggered?: boolean; isRetry?: boolean },
): Promise<void> => {
  const project = projectRepo.getProject(projectId);
  if (!project) return;

  const issue = issueRepo.getIssue(issueId);
  if (!issue) return;

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
    return;
  }

  const activeCount = getActiveProcessCount(projectId);
  if (activeCount >= project.max_concurrency) {
    // Don't queue duplicates
    if (dispatchQueue.isQueued(projectId, issueId, agent.id)) {
      postSystemComment(
        issueId,
        projectId,
        `Agent ${agent.name} is already queued`,
      );
      // Rollback the chain_depth increment since we're not spawning
      database.db
        .prepare("UPDATE Issue SET chain_depth = chain_depth - 1 WHERE id = ?")
        .run(issueId);
      return;
    }
    // Queue the dispatch instead of rejecting
    const position = dispatchQueue.enqueue({
      projectId,
      issueId,
      agentId: agent.id,
      queuedAt: new Date(),
      commentAuthorAgentId,
    });
    const ahead = position;
    postSystemComment(
      issueId,
      projectId,
      `Agent ${agent.name} queued${ahead > 0 ? ` (${ahead} agent${ahead === 1 ? "" : "s"} ahead)` : " (next in line)"}`,
    );
    events.eventBus.emit("dispatch.queued", {
      project_id: projectId,
      issue_id: issueId,
      agent_id: agent.id,
      position,
    });
    // Rollback the chain_depth increment since we're not spawning now
    database.db
      .prepare("UPDATE Issue SET chain_depth = chain_depth - 1 WHERE id = ?")
      .run(issueId);
    return;
  }

  // Regress status to in_progress when work restarts
  if (
    issue.status === "done" ||
    issue.status === "open" ||
    issue.status.startsWith("pr_")
  ) {
    issueRepo.updateIssue(issueId, { status: "in_progress" });
    events.eventBus.emit("issue.status_changed", {
      issue_id: issueId,
      project_id: projectId,
      from: issue.status,
      to: "in_progress",
    });
  }

  // Create worktree if needed, or re-create if it was cleaned up (e.g. /tmp cleared on reboot)
  const repo = getFirstRepo(projectId);
  const creds = getProjectCredentials(projectId);
  let worktreePath = issue.worktree_path;

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
      creds?.sshPrivateKey,
    );
    worktreePath = result.path;
  }

  const comments = commentRepo.listComments(issueId);

  // Project issues (currently unused — Captain orchestrates directly)
  const projectIssues = undefined;

  const projectKnowledge = knowledgeRepo.listForAgent(projectId, agent.id);

  const prompt = agentPrompt.buildPrompt({
    issue: issueRepo.getIssue(issueId)!,
    comments,
    repo: repo ?? null,
    worktreePath: worktreePath ?? ".",
    agentId: agent.id,
    projectIssues,
    projectKnowledge,
  });

  const envVars = getEnvVars(projectId);
  const env: Record<string, string> = {
    ...envVars,
    CREWDECK_API_URL: `http://localhost:${process.env.PORT || "9381"}`,
    CREWDECK_PROJECT_ID: projectId,
    CREWDECK_AGENT_ID: agent.id,
    CREWDECK_ISSUE_ID: issueId,
  };

  // Inject SSH + GH_TOKEN so agents can push and use gh CLI
  let sshKeyPath: string | undefined;
  if (creds) {
    const ssh = createGitSshEnv(creds.sshPrivateKey);
    sshKeyPath = ssh.keyPath;
    Object.assign(env, ssh.env);
    env.GH_TOKEN = creds.ghToken;
  }

  // Create AgentRun record
  const agentRun = agentRunRepo.createAgentRun({
    project_id: projectId,
    issue_id: issueId,
    agent_id: agent.id,
    status: "running",
  });

  const result = await agentProcess.spawnClaudeStream({
    prompt,
    systemPrompt: agent.system_prompt,
    workdir: worktreePath ?? ".",
    env,
  });

  // Update run with PID
  agentRunRepo.updateAgentRun(agentRun.id, { pid: result.pid });

  const timeoutMs =
    (project.agent_timeout_minutes ?? DEFAULT_AGENT_TIMEOUT_MINUTES) *
    60 *
    1000;
  const timeoutState = { timedOut: false };
  const timer = setTimeout(() => {
    timeoutState.timedOut = true;
    log.logger.warn(
      { pid: result.pid, agentId: agent.id, issueId },
      "Agent process timed out",
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

  events.eventBus.emit("mention.spawned", {
    project_id: projectId,
    issue_id: issueId,
    agent_id: agent.id,
    pid: result.pid,
  });

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
    "Agent spawned",
  );

  // Process streamed events
  const agentTimeoutMinutes =
    project.agent_timeout_minutes ?? DEFAULT_AGENT_TIMEOUT_MINUTES;
  processAgentStream(
    result,
    agentRun.id,
    projectId,
    issueId,
    agent,
    timer,
    timeoutState,
    agentTimeoutMinutes,
    options,
  )
    .catch((err) => {
      log.logger.error(
        { err, runId: agentRun.id },
        "Error processing agent stream",
      );
    })
    .finally(() => {
      if (sshKeyPath) cleanupSshKey(sshKeyPath);
    });
};

/**
 * Spawn a librarian scan without an issue.
 * Runs against the main repo, not a worktree.
 * @param {string} projectId - Project to scan
 * @returns {Promise<string>} The agent run ID
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

  const repo = getFirstRepo(projectId);
  const repoPath = repo ? toContainerPath(repo.local_path) : ".";

  const projectKnowledge = knowledgeRepo.listForAgent(projectId, agent.id);

  const prompt = agentPrompt.buildScanPrompt({
    repo: repo ?? null,
    repoPath,
    projectKnowledge,
  });

  const envVars = getEnvVars(projectId);
  const env: Record<string, string> = {
    ...envVars,
    CREWDECK_API_URL: `http://localhost:${process.env.PORT || "9381"}`,
    CREWDECK_PROJECT_ID: projectId,
    CREWDECK_AGENT_ID: agent.id,
  };

  // Create AgentRun record (no issue_id for scans)
  const agentRun = agentRunRepo.createAgentRun({
    project_id: projectId,
    issue_id: null,
    agent_id: agent.id,
    status: "running",
  });

  const result = await agentProcess.spawnClaudeStream({
    prompt,
    systemPrompt: agent.system_prompt,
    workdir: repoPath,
    env,
  });

  // Update run with PID
  agentRunRepo.updateAgentRun(agentRun.id, { pid: result.pid });

  const timeoutMs =
    (project.agent_timeout_minutes ?? DEFAULT_AGENT_TIMEOUT_MINUTES) *
    60 *
    1000;
  const timeoutState = { timedOut: false };
  const timer = setTimeout(() => {
    timeoutState.timedOut = true;
    log.logger.warn(
      { pid: result.pid, agentId: agent.id },
      "Scan process timed out",
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
    issueId: null,
    agentId: agent.id,
    agentRunId: agentRun.id,
    timer,
  };
  activeProcesses.set(result.pid, entry);

  events.eventBus.emit("run.started", {
    agent_run_id: agentRun.id,
    project_id: projectId,
    issue_id: null,
    agent_id: agent.id,
    status: agentRun.status,
    started_at: agentRun.started_at,
  });

  log.logger.info(
    { pid: result.pid, agent: agent.name, runId: agentRun.id },
    "Scan spawned",
  );

  // Process streamed events
  const scanTimeoutMinutes =
    project.agent_timeout_minutes ?? DEFAULT_AGENT_TIMEOUT_MINUTES;
  processAgentStream(
    result,
    agentRun.id,
    projectId,
    null,
    agent,
    timer,
    timeoutState,
    scanTimeoutMinutes,
  ).catch((err) => {
    log.logger.error(
      { err, runId: agentRun.id },
      "Error processing scan stream",
    );
  });

  return agentRun.id;
};
