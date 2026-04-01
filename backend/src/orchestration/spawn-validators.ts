/**
 * Validation and guard functions for agent spawning.
 */
import * as events from "../events/bus.js";
import * as issueRepo from "../db/repositories/issues.js";
import * as projectRepo from "../db/repositories/projects.js";
import * as issuePRRepo from "../db/repositories/issue-prs.js";
import * as database from "../db/index.js";
import * as log from "../logger.js";
import * as dispatchQueue from "./dispatch-queue.js";
import { clearPendingSpawn } from "./processes.js";
import { isIssuePaused } from "../services/issue-service.js";
import { postSystemComment } from "./spawn-process.js";
import {
  IssueStatus,
  PR_RELATED_ISSUE_STATUSES,
  PRStatus,
} from "../constants/statuses.js";
import type { IssueStatusValue } from "../constants/statuses.js";
import type { Agent } from "../types/entities.js";

/**
 * Regress DONE/OPEN/PR status back to IN_PROGRESS when work restarts.
 */
export function regressIssueStatus(
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
export function validateNoMergedPR(
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
export function validateCanSpawn(
  agent: Agent,
  issueId: string,
  projectId: string,
): boolean {
  if (isIssuePaused(issueId)) {
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
export function handleConcurrencyQueuing(
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
