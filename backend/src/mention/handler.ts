/**
 * Core orchestration for @mention-driven agent spawning.
 * Listens for comment.added events, parses mentions, spawns agents,
 * and posts results back as comments.
 */
import { type ChildProcess } from "node:child_process";
import * as events from "../events/bus.js";
import * as mentionParser from "./parser.js";
import * as agentProcess from "../agent/adapters/process.js";
import * as agentPrompt from "../agent/prompt.js";
import * as agentWorktree from "../agent/worktree.js";
import * as agentRepo from "../db/repositories/agents.js";
import * as issueRepo from "../db/repositories/issues.js";
import * as commentRepo from "../db/repositories/comments.js";
import * as projectRepo from "../db/repositories/projects.js";
import * as database from "../db/index.js";
import * as log from "../logger.js";
import type { Agent, Comment } from "../types/entities.js";

const MAX_CHAIN_DEPTH = 20;
const PROCESS_TIMEOUT_MS = 10 * 60 * 1000;

interface ActiveProcess {
  pid: number;
  process: ChildProcess;
  projectId: string;
  issueId: string;
  agentId: string;
  timer: ReturnType<typeof setTimeout>;
}

const activeProcesses = new Map<number, ActiveProcess>();

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
 * @returns {boolean} True if processes are running
 */
export const hasActiveProcesses = (issueId: string): boolean => {
  for (const p of activeProcesses.values())
    if (p.issueId === issueId) return true;
  return false;
};

/**
 * Post a system comment and emit comment.added.
 * @param {string} issueId - Target issue
 * @param {string} projectId - Parent project
 * @param {string} content - Comment body
 */
const postSystemComment = (issueId: string, projectId: string, content: string): void => {
  const comment = commentRepo.createComment(issueId, {
    content,
    author_type: "system",
  });
  events.eventBus.emit("comment.added", { comment, project_id: projectId });
};

/**
 * Get the first repo for a project.
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
 * Spawn an agent process for a mentioned agent on an issue.
 * Handles chain depth, concurrency, worktree creation, and process lifecycle.
 * @param {Agent} agent - Agent to spawn
 * @param {string} issueId - Target issue
 * @param {string} projectId - Parent project
 * @param {string} [commentAuthorAgentId] - Author of the triggering comment
 */
const spawnAgent = async (
  agent: Agent,
  issueId: string,
  projectId: string,
  commentAuthorAgentId?: string,
): Promise<void> => {
  const issue = issueRepo.getIssue(issueId);
  if (!issue) return;

  const project = projectRepo.getProject(projectId);
  if (!project) return;

  if (issue.chain_depth >= MAX_CHAIN_DEPTH) {
    postSystemComment(
      issueId,
      projectId,
      `Chain depth limit reached (${MAX_CHAIN_DEPTH}). No more agents can be spawned on this issue. Use the "Reset chain depth" button to continue.`,
    );
    events.eventBus.emit("mention.chain_depth_reached" as any, {
      issue_id: issueId,
      project_id: projectId,
    });
    return;
  }

  const activeCount = getActiveProcessCount(projectId);
  if (activeCount >= project.max_concurrency) {
    postSystemComment(
      issueId,
      projectId,
      `Too many agents running (${activeCount}/${project.max_concurrency}). Try again later.`,
    );
    return;
  }

  issueRepo.updateIssue(issueId, { chain_depth: issue.chain_depth + 1 });

  // Regress status to in_progress when work restarts
  if (
    issue.status === "done" ||
    issue.status === "pr_created" ||
    issue.status === "open"
  ) {
    issueRepo.updateIssue(issueId, { status: "in_progress" });
    events.eventBus.emit("issue.status_changed", {
      issue_id: issueId,
      project_id: projectId,
      from: issue.status,
      to: "in_progress",
    });
  }

  // Create worktree if needed
  const repo = getFirstRepo(projectId);
  let worktreePath = issue.worktree_path;

  if (!worktreePath && repo) {
    const freshIssue = issueRepo.getIssue(issueId)!;
    const result = await agentWorktree.createWorktree(
      repo as any,
      freshIssue,
      repo.default_branch,
    );
    worktreePath = result.path;
  }

  const comments = commentRepo.listComments(issueId);
  const prompt = agentPrompt.buildPrompt(
    issueRepo.getIssue(issueId)!,
    comments,
    repo ?? null,
    worktreePath ?? ".",
  );

  const envVars = getEnvVars(projectId);
  const env: Record<string, string> = {
    ...envVars,
    CREWDECK_API_URL: `http://localhost:${process.env.PORT || "9381"}`,
    CREWDECK_PROJECT_ID: projectId,
    CREWDECK_AGENT_ID: agent.id,
  };

  const result = await agentProcess.spawnClaude({
    prompt,
    systemPrompt: agent.system_prompt,
    workdir: worktreePath ?? ".",
    env,
  });

  const timer = setTimeout(() => {
    log.logger.warn(
      { pid: result.pid, agentId: agent.id, issueId },
      "Agent process timed out",
    );
    result.process.kill("SIGTERM");
    setTimeout(() => {
      if (!result.process.killed) result.process.kill("SIGKILL");
    }, 5000);
  }, PROCESS_TIMEOUT_MS);

  const entry: ActiveProcess = {
    pid: result.pid,
    process: result.process,
    projectId,
    issueId,
    agentId: agent.id,
    timer,
  };
  activeProcesses.set(result.pid, entry);

  events.eventBus.emit("mention.spawned" as any, {
    project_id: projectId,
    issue_id: issueId,
    agent_id: agent.id,
    pid: result.pid,
  });

  log.logger.info({ pid: result.pid, agent: agent.name, issueId }, "Agent spawned");

  result.exitPromise.then(({ code, stdout }) => {
    clearTimeout(timer);
    activeProcesses.delete(result.pid);

    if (code === 0) {
      let resultText = "";
      let cost: number | undefined;
      let durationMs: number | undefined;

      try {
        const parsed = JSON.parse(stdout);
        resultText = parsed.result ?? stdout;
        cost = parsed.cost_usd ?? parsed.total_cost_usd;
        durationMs = parsed.duration_ms;
      } catch {
        resultText = stdout;
      }

      if (resultText) {
        const comment = commentRepo.createComment(issueId, {
          content: resultText,
          author_type: "agent",
          author_id: agent.id,
        });
        events.eventBus.emit("comment.added", { comment, project_id: projectId });
      }

      postSystemComment(
        issueId,
        projectId,
        `Agent ${agent.name} finished${cost ? ` (cost: $${cost.toFixed(4)})` : ""}${durationMs ? ` (${Math.round(durationMs / 1000)}s)` : ""}`,
      );

      log.logger.info(
        { pid: result.pid, agent: agent.name, cost, durationMs },
        "Agent finished",
      );
    } else {
      const hasOutput = stdout.trim().length > 0;
      postSystemComment(
        issueId,
        projectId,
        `Agent ${agent.name} ${code === null ? "timed out (10 min limit" : `crashed (exit code ${code}`}${hasOutput ? "" : ", no output"})`,
      );
      log.logger.error(
        { pid: result.pid, code, agent: agent.name },
        "Agent process failed",
      );
    }

    events.eventBus.emit("mention.completed" as any, {
      project_id: projectId,
      issue_id: issueId,
      agent_id: agent.id,
      exit_code: code,
    });
  });
};

/**
 * Initialize the mention handler by subscribing to comment.added events.
 */
export const initMentionHandler = (): void => {
  events.eventBus.on("comment.added", ({ comment, project_id }) => {
    // Skip system comments to avoid infinite loops
    if (comment.author_type === "system") return;

    const issue = issueRepo.getIssue(comment.issue_id);
    if (!issue) return;

    const agents = agentRepo.listAgents(project_id);
    const mentioned = mentionParser.parseMentions(
      comment.content,
      agents,
      comment.author_id ?? undefined,
    );

    for (const agent of mentioned) {
      spawnAgent(agent, comment.issue_id, project_id, comment.author_id ?? undefined).catch(
        (err) => {
          log.logger.error(
            { err, agent: agent.name, issueId: comment.issue_id },
            "Failed to spawn agent",
          );
          postSystemComment(
            comment.issue_id,
            project_id,
            `Failed to spawn agent ${agent.name}: ${err instanceof Error ? err.message : "unknown error"}`,
          );
        },
      );
    }
  });

  log.logger.info("MentionHandler initialized");
};

/**
 * Terminate all active processes and clear tracking state.
 */
export const shutdownMentionHandler = (): void => {
  for (const entry of activeProcesses.values()) {
    clearTimeout(entry.timer);
    entry.process.kill("SIGTERM");
  }
  activeProcesses.clear();
};

/**
 * Log startup recovery. Spawns from before a crash are lost.
 */
export const recoverOnStartup = (): void => {
  log.logger.info("MentionHandler startup recovery complete");
};
