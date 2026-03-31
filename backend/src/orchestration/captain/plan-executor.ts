/**
 * Plan Executor
 *
 * Executes structured action plans from the Monitor LLM.
 * Handles dispatch, merge, scan, comment, and issue operations.
 */
import { logger } from "../../logger.js";
import { eventBus } from "../../events/bus.js";
import { getActiveProcessCount } from "../processes.js";
import { getProject } from "../../db/repositories/projects.js";
import * as issueRepo from "../../db/repositories/issues.js";
import * as commentRepo from "../../db/repositories/comments.js";
import {
  handleDispatchAgent,
  handleMergePR,
  handleCreatePR,
  handleScanCodebase,
} from "../command-handlers.js";
import type {
  Action,
  ActionPlan,
  DispatchAction,
  MergeAction,
  CommentAction,
  CreateIssueAction,
  UpdateIssueAction,
  CreatePRAction,
  SkipAction,
  SetDependenciesAction,
} from "./action-schema.js";
import * as issueDepsRepo from "../../db/repositories/issue-dependencies.js";
import { clearStartApproval, clearMergeApproval } from "../approval-store.js";

/** Standard UUID length (32 hex + 4 hyphens) */
const UUID_LENGTH = 36;

/**
 * Resolve a potentially truncated issue ID to a full UUID.
 * If the ID is already a full UUID or found by exact match, returns it as-is.
 * If it looks like a prefix (shorter than a full UUID), tries prefix matching
 * scoped to the project. Returns null if not found or ambiguous.
 */
function resolveIssueId(issueId: string, projectId: string): string | null {
  // Try exact match first
  const exact = issueRepo.getIssue(issueId);
  if (exact) return exact.id;

  // If it looks like a truncated ID, try prefix match
  if (issueId.length < UUID_LENGTH && issueId.length >= 8) {
    const match = issueRepo.getIssueByPrefix(issueId, projectId);
    if (match) {
      logger.info(
        { prefix: issueId, resolved: match.id },
        "Monitor: Resolved truncated issue ID",
      );
      return match.id;
    }
  }

  return null;
}

export interface ActionResult {
  action: Action;
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * Execute a dispatch action.
 */
async function executeDispatch(
  projectId: string,
  action: DispatchAction,
): Promise<ActionResult> {
  const result = await handleDispatchAgent(projectId, {
    issue_id: action.issue_id,
    agent_id: action.agent_id,
    instructions: action.instructions,
  });
  // Clear the start approval flag after successful dispatch
  if (result.success) {
    clearStartApproval(action.issue_id);
  }
  return {
    action,
    success: result.success,
    message: result.message,
    data: result.data,
  };
}

/**
 * Execute a merge action.
 */
async function executeMerge(
  projectId: string,
  action: MergeAction,
): Promise<ActionResult> {
  const result = await handleMergePR(projectId, { issue_id: action.issue_id });
  // Clear the merge approval flag after successful merge
  if (result.success) {
    clearMergeApproval(action.issue_id);
  }
  return {
    action,
    success: result.success,
    message: result.message,
    data: result.data,
  };
}

/**
 * Execute a scan action.
 */
async function executeScan(projectId: string): Promise<ActionResult> {
  const result = await handleScanCodebase(projectId);
  return {
    action: { type: "scan" },
    success: result.success,
    message: result.message,
    data: result.data,
  };
}

/**
 * Execute a comment action.
 */
function executeComment(
  projectId: string,
  action: CommentAction,
): ActionResult {
  try {
    const issue = issueRepo.getIssue(action.issue_id);
    if (!issue) {
      return { action, success: false, message: "Issue not found" };
    }
    if (issue.project_id !== projectId) {
      return {
        action,
        success: false,
        message: "Issue belongs to a different project",
      };
    }
    const comment = commentRepo.createComment(action.issue_id, {
      author_type: "captain",
      content: action.content,
    });
    eventBus.emit("comment.added", { comment, project_id: projectId });
    return { action, success: true, message: "Comment added" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      action,
      success: false,
      message: `Failed to add comment: ${message}`,
    };
  }
}

/**
 * Execute a create-issue action.
 *
 * Note: Issues created here use created_by: "agent" which is filtered out
 * by monitor-service.ts handleIssueCreated. This prevents chain reactions
 * where Monitor sees its own issue creations. The mutex is also held during
 * plan execution, so any events emitted here won't trigger a new Monitor
 * invocation until after this one completes.
 */
function executeCreateIssue(
  projectId: string,
  action: CreateIssueAction,
): ActionResult {
  try {
    const issue = issueRepo.createIssue(projectId, {
      title: action.title,
      description: action.description ?? "",
      created_by: "agent",
    });
    eventBus.emit("issue.created", { issue });
    return {
      action,
      success: true,
      message: `Created issue: ${issue.title}`,
      data: { issue_id: issue.id },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      action,
      success: false,
      message: `Failed to create issue: ${message}`,
    };
  }
}

/**
 * Execute an update-issue action.
 */
function executeUpdateIssue(
  projectId: string,
  action: UpdateIssueAction,
): ActionResult {
  try {
    const issue = issueRepo.getIssue(action.issue_id);
    if (!issue) {
      return { action, success: false, message: "Issue not found" };
    }
    if (issue.project_id !== projectId) {
      return {
        action,
        success: false,
        message: "Issue belongs to a different project",
      };
    }
    const updates: { status?: string; title?: string } = {};
    if (action.status !== undefined) updates.status = action.status;
    if (action.title !== undefined) updates.title = action.title;
    if (Object.keys(updates).length === 0) {
      return { action, success: false, message: "No updates provided" };
    }
    const oldStatus = issue.status;
    issueRepo.updateIssue(action.issue_id, updates);
    if (action.status && action.status !== oldStatus) {
      eventBus.emit("issue.status_changed", {
        issue_id: action.issue_id,
        project_id: projectId,
        from: oldStatus,
        to: action.status,
        actor_type: "agent",
        actor_id: "captain",
      });
    }
    return { action, success: true, message: "Issue updated" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      action,
      success: false,
      message: `Failed to update issue: ${message}`,
    };
  }
}

/**
 * Execute a create-pr action.
 */
async function executeCreatePR(
  projectId: string,
  action: CreatePRAction,
): Promise<ActionResult> {
  const result = await handleCreatePR(projectId, {
    issue_id: action.issue_id,
  });
  return {
    action,
    success: result.success,
    message: result.message,
    data: result.data,
  };
}

/**
 * Execute a skip action (no-op, logged for observability).
 */
function executeSkip(action: SkipAction): ActionResult {
  logger.info(
    { issue_id: action.issue_id, reason: action.reason },
    "Monitor: Skipping issue",
  );
  return { action, success: true, message: `Skipped: ${action.reason}` };
}

/**
 * Execute a set-dependencies action.
 */
function executeSetDependencies(
  projectId: string,
  action: SetDependenciesAction,
): ActionResult {
  try {
    const issue = issueRepo.getIssue(action.issue_id);
    if (!issue) {
      return { action, success: false, message: "Issue not found" };
    }
    if (issue.project_id !== projectId) {
      return {
        action,
        success: false,
        message: "Issue belongs to a different project",
      };
    }

    // Resolve truncated dependency IDs before passing to repository
    const resolvedDeps: string[] = [];
    for (const depId of action.depends_on) {
      const resolved = resolveIssueId(depId, projectId);
      if (resolved) {
        resolvedDeps.push(resolved);
      } else {
        logger.warn(
          { depId, issueId: action.issue_id },
          "Monitor: Could not resolve dependency ID, skipping",
        );
      }
    }

    const added = issueDepsRepo.setDependencies(action.issue_id, resolvedDeps);
    return {
      action,
      success: true,
      message: `Set ${added.length} dependencies`,
      data: { dependencies: added },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      action,
      success: false,
      message: `Failed to set dependencies: ${message}`,
    };
  }
}

/**
 * Resolve any truncated issue_id on an action before execution.
 * Mutates the action in place. Returns an error ActionResult if resolution fails.
 */
function resolveActionIssueId(
  projectId: string,
  action: Action,
): ActionResult | null {
  if (!("issue_id" in action) || !action.issue_id) return null;

  const resolved = resolveIssueId(action.issue_id, projectId);
  if (!resolved) {
    return {
      action,
      success: false,
      message: `Issue not found for ID "${action.issue_id}"`,
    };
  }
  action.issue_id = resolved;
  return null;
}

/**
 * Execute a single action.
 */
async function executeAction(
  projectId: string,
  action: Action,
): Promise<ActionResult> {
  // Resolve truncated issue IDs before executing
  const resolveError = resolveActionIssueId(projectId, action);
  if (resolveError) return resolveError;

  switch (action.type) {
    case "dispatch":
      return executeDispatch(projectId, action);
    case "merge":
      return executeMerge(projectId, action);
    case "scan":
      return executeScan(projectId);
    case "comment":
      return executeComment(projectId, action);
    case "create-issue":
      return executeCreateIssue(projectId, action);
    case "update-issue":
      return executeUpdateIssue(projectId, action);
    case "create-pr":
      return executeCreatePR(projectId, action);
    case "skip":
      return executeSkip(action);
    case "set-dependencies":
      return executeSetDependencies(projectId, action);
    default:
      return {
        action,
        success: false,
        message: `Unknown action type: ${(action as Action).type}`,
      };
  }
}

/**
 * Execute an action plan.
 * Dispatches run in parallel up to available capacity.
 * Other actions run sequentially for predictable ordering.
 */
export async function executePlan(
  projectId: string,
  plan: ActionPlan,
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  const project = getProject(projectId);
  if (!project) {
    return [
      {
        action: { type: "skip", issue_id: "", reason: "Project not found" },
        success: false,
        message: "Project not found",
      },
    ];
  }

  // Separate dispatch actions from others
  const dispatchActions: DispatchAction[] = [];
  const otherActions: Action[] = [];

  for (const action of plan.actions) {
    if (action.type === "dispatch") {
      dispatchActions.push(action);
    } else {
      otherActions.push(action);
    }
  }

  // Execute dispatch actions in parallel up to available capacity
  if (dispatchActions.length > 0) {
    const runningAgents = getActiveProcessCount(projectId);
    const availableSlots = Math.max(0, project.max_concurrency - runningAgents);

    logger.info(
      {
        projectId,
        dispatchCount: dispatchActions.length,
        availableSlots,
        runningAgents,
      },
      "Monitor: Executing dispatch actions",
    );

    // Resolve truncated issue IDs on dispatch actions before executing
    const resolvedDispatches: DispatchAction[] = [];
    for (const action of dispatchActions) {
      const err = resolveActionIssueId(projectId, action);
      if (err) {
        results.push(err);
      } else {
        resolvedDispatches.push(action);
      }
    }

    // Execute all dispatches - spawnAgent handles queuing internally
    const dispatchPromises = resolvedDispatches.map((action) =>
      executeDispatch(projectId, action),
    );
    const dispatchResults = await Promise.all(dispatchPromises);
    results.push(...dispatchResults);
  }

  // Execute other actions sequentially
  for (const action of otherActions) {
    const result = await executeAction(projectId, action);
    results.push(result);

    // Emit action execution event for frontend visibility
    eventBus.emit("monitor.tool_result", {
      project_id: projectId,
      tool_name: action.type,
      result: { success: result.success, message: result.message },
    });
  }

  return results;
}

/**
 * Format action results for logging/display.
 */
export function formatResults(results: ActionResult[]): string {
  if (results.length === 0) return "No actions executed.";

  return results
    .map((r) => {
      const status = r.success ? "✓" : "✗";
      return `${status} ${r.action.type}: ${r.message}`;
    })
    .join("\n");
}
