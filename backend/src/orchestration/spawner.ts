/**
 * Agent spawning orchestrator.
 * Composes validators, environment builders, and process lifecycle modules.
 */
import * as events from "../events/bus.js";
import * as crew from "./crew.js";
import * as issueRepo from "../db/repositories/issues.js";
import * as projectRepo from "../db/repositories/projects.js";
import * as agentRunRepo from "../db/repositories/agent-runs.js";
import * as knowledgeRepo from "../db/repositories/knowledge.js";
import * as repoRepo from "../db/repositories/repos.js";
import * as agentPrompt from "./prompt.js";
import * as database from "../db/index.js";
import * as log from "../logger.js";
import { toContainerPath } from "../utils/paths.js";
import { clearPendingSpawn } from "./processes.js";
import { cleanupSshKey } from "../utils/git-auth.js";
import * as agentConfigRepo from "../db/repositories/agent-config.js";
import * as globalConfigRepo from "../db/repositories/global-config.js";
import { isIssuePaused } from "../services/issue-service.js";
import type { Agent, AgentRun } from "../types/entities.js";
import { postSystemComment, spawnAndTrack } from "./spawn-process.js";
import {
  validateCanSpawn,
  validateNoMergedPR,
  regressIssueStatus,
  handleConcurrencyQueuing,
} from "./spawn-validators.js";
import {
  buildAgentEnvironment,
  validateOrRecreateWorktree,
  buildAgentPrompt,
} from "./spawn-environment.js";

export { postSystemComment } from "./spawn-process.js";

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

  const maxChainDepth = globalConfigRepo.getMaxChainDepth();

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
      agentRunRepo.countRunningGlobal() >= globalConfigRepo.getMaxConcurrency(),
      "global limit reached",
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

  const timeoutMinutes = globalConfigRepo.getAgentTimeoutMinutes();
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

  if (isIssuePaused(issueId)) {
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
  const timeoutMinutes = globalConfigRepo.getAgentTimeoutMinutes();
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

  // Check global concurrency limit (scans can't be queued since they have no issue)
  const activeCount = agentRunRepo.countRunningGlobal();
  const maxConcurrency = globalConfigRepo.getMaxConcurrency();
  if (activeCount >= maxConcurrency) {
    throw new Error(
      `Global concurrency limit reached (${maxConcurrency} agents running). Try again later.`,
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

  const { env } = buildAgentEnvironment(projectId, agent.id);

  const timeoutMinutes = globalConfigRepo.getAgentTimeoutMinutes();

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
