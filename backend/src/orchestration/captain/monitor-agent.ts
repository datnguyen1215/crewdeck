/**
 * Monitor LLM Agent
 *
 * Uses `claude -p` CLI to make automated orchestration decisions.
 * Handles events like issue creation, run completion, PR status changes.
 * User chat goes through the PTY terminal.
 *
 * Outputs structured action plans that the backend executes deterministically.
 */
import { logger } from "../../logger.js";
import { eventBus } from "../../events/bus.js";
import {
  getProject,
  updateCaptainStatus,
} from "../../db/repositories/projects.js";
import { getActiveProcessCount } from "../processes.js";
import { spawnClaudeStream } from "../process.js";
import { resolveModel } from "../../db/repositories/agent-config.js";
import { parseActionPlan, extractJsonFromResponse } from "./action-schema.js";
import { executePlan, formatResults } from "./plan-executor.js";
import type { ActionPlan } from "./action-schema.js";
import { getIssue, listIssues } from "../../db/repositories/issues.js";
import { listActiveRunsForProject } from "../../db/repositories/agent-runs.js";
import { listByProject as listKnowledge } from "../../db/repositories/knowledge.js";
import { listComments } from "../../db/repositories/comments.js";
import { getIssuePR, listIssuePRs } from "../../db/repositories/issue-prs.js";
import { getCrewMember } from "../crew.js";
import type { Issue } from "../../types/entities.js";

import * as chatRepo from "../../db/repositories/chat-messages.js";
import type { CaptainEvent } from "./queue.js";

/**
 * Build a compact snapshot of current project state to inject into the prompt,
 * eliminating the need for initial curl calls.
 */
function buildStateSnapshot(projectId: string): string {
  const parts: string[] = [];

  // Compact issues (non-closed, no descriptions)
  const issues = listIssues(projectId, {
    status: [
      "open",
      "in_progress",
      "pr_created",
      "pr_ready_to_merge",
      "pr_conflict",
      "pr_failed_actions",
    ],
  });
  if (issues.length > 0) {
    const rows = issues.map((i) => {
      const agent = i.running_agent_id ? ` [agent: ${i.running_agent_id}]` : "";
      const paused = i.paused ? " (paused)" : "";
      const prs = listIssuePRs(i.id);
      const openPR = prs.filter((p) => p.status === "open").at(-1);
      const prInfo = openPR
        ? ` [PR: #${openPR.pr_number}${openPR.pr_url ? ` ${openPR.pr_url}` : ""}]`
        : "";
      return `- ${i.id} | ${i.status}${paused}${agent}${prInfo} | ${i.title}`;
    });
    parts.push(`### Issues (non-closed)\n${rows.join("\n")}`);
  } else {
    parts.push("### Issues (non-closed)\nNone");
  }

  // Active runs
  const runs = listActiveRunsForProject(projectId);
  if (runs.length > 0) {
    const rows = runs.map((r) => {
      const agent = getCrewMember(r.agent_id);
      const name = agent?.name ?? r.agent_id;
      const issue = r.issue_id ? ` on issue ${r.issue_id}` : "";
      return `- ${r.id} | ${name} (${r.status})${issue}`;
    });
    parts.push(`### Active Runs\n${rows.join("\n")}`);
  } else {
    parts.push("### Active Runs\nNone");
  }

  // Knowledge titles
  const knowledge = listKnowledge(projectId);
  if (knowledge.length > 0) {
    const rows = knowledge.map((k) => `- ${k.id} | [${k.category}] ${k.title}`);
    parts.push(`### Knowledge Entries\n${rows.join("\n")}`);
  } else {
    parts.push("### Knowledge Entries\nNone");
  }

  return parts.join("\n\n");
}

/**
 * Build the system prompt for Monitor — focused on orchestration decisions.
 */
const buildSystemPrompt = (projectId: string): string => {
  const project = getProject(projectId);
  if (!project) return "";

  const runningAgents = getActiveProcessCount(projectId);

  const canAutoStart = project.auto_start;
  const canMerge = project.auto_merge;

  const snapshot = buildStateSnapshot(projectId);

  return `You are the Monitor, the autonomous orchestrator for a CrewDeck project.

## Role
You react to system events and make orchestration decisions automatically.
You can ${canMerge ? "merge PRs, " : ""}dispatch agents to work on issues, create new issues, and manage project knowledge.
You do NOT handle user chat — that is handled separately.

## Project: ${project.name}
${project.description || "No description"}

## Autonomy Settings
- Auto-start: ${canAutoStart ? "ENABLED — automatically dispatch agents on new issues" : "DISABLED — wait for user to trigger dispatch"}
- Auto-merge: ${canMerge ? "ENABLED — automatically merge PRs when ready" : "DISABLED — wait for user to approve merge"}

## Current Capacity
- Running agents: ${runningAgents}
- Max concurrency: ${project.max_concurrency}
- Available slots: ${Math.max(0, project.max_concurrency - runningAgents)}

## Current State (pre-fetched snapshot)
${snapshot}

This snapshot was fetched at prompt build time. Use it for your initial decisions. Only curl for details (full issue, run events, comments) when you need more information for a specific decision.

## API Reference (Read-Only — for fetching details)
Base: \`$CREWDECK_API_URL/api/v1\`

\`\`\`bash
# Full issue details — only when you need description, comments, PRs, or activity
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/<ISSUE_ID>"

# Comments on an issue
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/<ISSUE_ID>/comments"

# Runs for a specific issue
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/<ISSUE_ID>/runs"

# Single run with events
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/runs/<RUN_ID>"

# Activity log (filterable: issue_id, actor_type, action, since, limit)
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/activity?limit=20&compact=true"

# Full knowledge entry
curl "$CREWDECK_API_URL/api/v1/internal/knowledge/get?project_id=$CREWDECK_PROJECT_ID&knowledge_id=<ID>"
\`\`\`

## Action Plan Output

After gathering information, output a JSON action plan wrapped in <action> tags. The system will parse the tags and execute all actions deterministically.

**IMPORTANT**: You MUST wrap your action plan in <action> tags exactly like this:

<action>
{
  "reasoning": "Brief explanation of your decisions",
  "actions": [
    { "type": "dispatch", "issue_id": "<id>", "agent_id": "engineer", "instructions": "optional instructions" },
    { "type": "dispatch", "issue_id": "<id>", "agent_id": "lead" },
    { "type": "merge", "issue_id": "<id>" },
    { "type": "create-pr", "issue_id": "<id>" },
    { "type": "comment", "issue_id": "<id>", "content": "Comment text" },
    { "type": "create-issue", "title": "Title", "description": "Description" },
    { "type": "update-issue", "issue_id": "<id>", "status": "pr_created" },
    { "type": "scan" },
    { "type": "skip", "issue_id": "<id>", "reason": "Why skipping" }
  ]
}
</action>

You can include reasoning text before the <action> tags, but the tags MUST be present. If no actions are needed, use an empty actions array: <action>{"reasoning": "waiting for CI", "actions": []}</action>

**Never use null values.** Omit optional fields entirely instead of setting them to null.

### Action Types
| Type | Required Fields | Description |
|------|-----------------|-------------|
| dispatch | issue_id, agent_id | Dispatch agent (engineer/lead/docs/librarian) to work on issue |
| merge | issue_id | Merge the PR for an issue |
| create-pr | issue_id | Create a GitHub PR for the issue (uses issue branch_name, base_branch, repo_id) |
| comment | issue_id, content | Add a comment to an issue |
| create-issue | title | Create a new issue (description optional) |
| update-issue | issue_id | Update issue status/title |
| scan | (none) | Trigger librarian codebase scan |
| skip | issue_id, reason | Skip an issue (logged for observability) |

### Parallel Execution
List ALL dispatch actions needed. The system handles capacity limits and executes dispatches in parallel.
If 3 issues need work and 5 slots are available, list all 3 dispatches — they'll run simultaneously.

## Golden Rule
**Use the pre-fetched snapshot above for initial decisions.** It contains the current issues, active runs, and knowledge titles. Only curl for detailed information (full issue description, comments, run events) when needed for a specific decision.

**An issue being \`in_progress\` does NOT mean an agent is running.** Check the Active Runs section in the snapshot to verify.

## Event Response Rules
Events include full context (issue title, status, PR info, agent reports). Use this information directly — no need to curl for it.
- **issue.created**: ${canAutoStart ? "Dispatch engineer to work on the new issue. The description is included in the event." : "Acknowledge only — wait for user to trigger dispatch."}
- **run.completed**: The agent's report is included in the event. Decide the next step based on the report. Pass relevant context in dispatch instructions so the next agent doesn't start blind. **If the issue has an open PR (visible in the snapshot or event context), set its status back to \`pr_created\` so the PR poller re-evaluates CI and mergeability from GitHub.** Do this before dispatching a follow-up agent if needed.
- **issue.status_changed → done**: Check the snapshot for remaining work. Consider a librarian scan if the completed work changed project structure.
- **issue.status_changed → pr_conflict**: Dispatch engineer to resolve merge conflicts. Include the PR URL in dispatch instructions.
- **issue.status_changed → pr_failed_actions**: Dispatch engineer to fix CI failures. Include the PR URL in dispatch instructions.
- **issue.status_changed → pr_ready_to_merge**: ${canMerge ? "Merge the PR." : "Report that the PR is ready — auto-merge is disabled."}
- **issue.status_changed** (other): Check if any blocked issues are now unblocked.
- **pr.status_changed**: Issue and PR info are included. If merged, mark done. If closed, investigate.
- **comment.added**: The full comment is included. Act on user feedback.
- **startup.scan**: Use the snapshot above to assess project state and take any needed actions.
- **idle.check**: Use the snapshot to find stuck issues (in_progress with no running agents).
- **project.settings_changed**: Acknowledge and adjust behavior.

## Code Review Loop
Engineer → Lead review → fix cycle → Docs → Create PR. Read the lead's report each time to decide whether to iterate or move forward.

## Dispatch Rules
- Don't dispatch if an agent is already running on that issue (check current state first)
- Check issue descriptions for dependency references ("depends on", "blocked by", "after") — skip blocked issues
- List ALL needed dispatches — the system handles capacity and parallel execution
- ${canMerge ? "Merge ready PRs before starting new work" : "Report ready PRs — auto-merge is disabled"}

## Constraints
- You can only manage this project
- Use curl only for READ operations (list issues, get issue, list knowledge)
- All WRITE operations must be in the action plan JSON
- Don't make assumptions about external systems${!canMerge ? "\n- You cannot merge PRs. Auto-merge is disabled for this project." : ""}${!canAutoStart ? "\n- You cannot automatically start work on new issues. Auto-start is disabled — wait for user to dispatch." : ""}`;
};

/**
 * Get PR info for an issue (latest open PR).
 */
function getPRInfo(issueId: string): string {
  const prs = listIssuePRs(issueId);
  if (prs.length === 0) return "";
  const pr = prs[prs.length - 1]; // most recent
  return `\n  PR: #${pr.pr_number} (${pr.status})${pr.pr_url ? ` — ${pr.pr_url}` : ""}`;
}

/**
 * Get the latest agent comment on an issue (the agent's report).
 */
function getLatestAgentComment(issueId: string): string {
  const comments = listComments(issueId);
  // Walk backwards to find the last non-user comment
  for (let i = comments.length - 1; i >= 0; i--) {
    if (comments[i].author_type !== "user") {
      return `\n  Report (${comments[i].author_type}):\n${comments[i].content}`;
    }
  }
  return "";
}

/**
 * Format issue context line: id, title, status.
 */
function formatIssueContext(issue: Issue): string {
  return `\n  Issue: ${issue.id} | "${issue.title}" | status: ${issue.status}`;
}

/**
 * Format events for the LLM with enriched context from DB lookups.
 * Each event includes enough information for the captain to act immediately.
 */
export const formatEvents = (events: CaptainEvent[]): string => {
  if (events.length === 0) return "";

  return events
    .map((e) => {
      const ts = e.timestamp.toISOString().slice(11, 19);
      switch (e.type) {
        case "issue.created": {
          const data = e.data as { issue: Issue };
          const desc = data.issue.description
            ? `\n  Description: ${data.issue.description}`
            : "";
          return `[${ts}] Issue created: "${data.issue.title}" (${data.issue.id})${desc}`;
        }
        case "issue.status_changed": {
          const data = e.data as { issue_id: string; from: string; to: string };
          const issue = getIssue(data.issue_id);
          const title = issue ? ` "${issue.title}"` : "";
          const prInfo = issue ? getPRInfo(data.issue_id) : "";
          return `[${ts}] Issue ${data.issue_id}${title} status: ${data.from} → ${data.to}${prInfo}`;
        }
        case "run.completed": {
          const data = e.data as {
            agent_id: string;
            issue_id: string | null;
            status: string;
          };
          const agentName = getCrewMember(data.agent_id)?.name ?? data.agent_id;
          let context = "";
          if (data.issue_id) {
            const issue = getIssue(data.issue_id);
            if (issue) context += formatIssueContext(issue);
            context += getPRInfo(data.issue_id);
            context += getLatestAgentComment(data.issue_id);
          }
          return `[${ts}] Agent ${agentName} (${data.agent_id}) completed (${data.status})${data.issue_id ? ` on issue ${data.issue_id}` : ""}${context}`;
        }
        case "pr.status_changed": {
          const data = e.data as { pr_id: string; from: string; to: string };
          const pr = getIssuePR(data.pr_id);
          let context = "";
          if (pr) {
            const issue = getIssue(pr.issue_id);
            context += `\n  Issue: ${pr.issue_id}${issue ? ` | "${issue.title}"` : ""}`;
            context += `\n  PR: #${pr.pr_number}${pr.pr_url ? ` — ${pr.pr_url}` : ""}`;
          }
          return `[${ts}] PR status: ${data.from} → ${data.to}${context}`;
        }
        case "issue.updated": {
          const data = e.data as {
            issue_id: string;
            changes: Record<string, unknown>;
          };
          const issue = getIssue(data.issue_id);
          const title = issue ? ` "${issue.title}"` : "";
          const changedFields = Object.keys(data.changes || {}).join(", ");
          return `[${ts}] Issue ${data.issue_id}${title} updated: ${changedFields || "unknown fields"}`;
        }
        case "comment.added": {
          const data = e.data as {
            comment: {
              id: string;
              issue_id: string;
              author_type: string;
              content: string;
            };
            project_id: string;
          };
          const issue = getIssue(data.comment.issue_id);
          const title = issue ? ` "${issue.title}"` : "";
          return `[${ts}] Comment on issue ${data.comment.issue_id}${title} by ${data.comment.author_type}:\n${data.comment.content}`;
        }
        case "startup.scan":
          return `[${ts}] Startup scan: analyze current project state and take any needed actions`;
        case "idle.check":
          return `[${ts}] Idle check: checking for stuck issues`;
        case "project.settings_changed": {
          const data = e.data as { changes: Record<string, unknown> };
          const formatted = Object.entries(data.changes || {})
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ");
          return `[${ts}] Project settings changed: ${formatted || "unknown changes"}`;
        }
        default:
          return `[${ts}] Event: ${e.type}`;
      }
    })
    .join("\n\n");
};

const MAX_CONTEXT_MESSAGES = 100;

/**
 * Get monitor conversation history from DB.
 * Monitor messages are stored without a session_id.
 */
const getMonitorHistory = (projectId: string): string => {
  // Get recent messages without a session (monitor messages)
  const messages = chatRepo
    .getByProjectWithoutSession(projectId, MAX_CONTEXT_MESSAGES)
    .reverse();
  if (messages.length === 0) return "";

  return messages
    .map((m: { role: string; content: string }) => {
      if (m.role === "user") return `Event batch:\n${m.content}`;
      return `Monitor response: ${m.content}`;
    })
    .join("\n\n");
};

/**
 * Set up GitHub auth environment variables for Captain.
 */
const setupGitHubAuth = async (
  projectId: string,
  env: Record<string, string>,
): Promise<string | undefined> => {
  const project = getProject(projectId);
  if (!project?.vcs_account_id) return undefined;

  const { getVCSAccount } =
    await import("../../db/repositories/vcs-accounts.js");
  const account = getVCSAccount(project.vcs_account_id);
  if (!account) return undefined;

  env.GH_TOKEN = account.token;
  const { createGitSshEnv } = await import("../../utils/git-auth.js");
  const ssh = createGitSshEnv(account.ssh_private_key);
  Object.assign(env, ssh.env);
  return ssh.keyPath;
};

/**
 * Extract action plan from Claude stream events.
 * Looks for the final result message and parses JSON from it.
 */
function extractActionPlanFromEvents(
  events: Array<{ type: string; [key: string]: unknown }>,
): ActionPlan | null {
  // Find the result event (final assistant message)
  const resultEvent = events.find((e) => e.type === "result");
  if (!resultEvent) return null;

  const resultText =
    typeof resultEvent.result === "string" ? resultEvent.result : null;
  if (!resultText) return null;

  const json = extractJsonFromResponse(resultText);
  if (!json) return null;

  return parseActionPlan(json);
}

/**
 * Process monitor events with the LLM via claude -p with streaming.
 * Returns the action plan execution results.
 */
export const processWithLLM = async (
  projectId: string,
  events: CaptainEvent[],
): Promise<string> => {
  const systemPrompt = buildSystemPrompt(projectId);
  if (!systemPrompt) return "Error: Project not found";

  const eventText = formatEvents(events);
  const eventSection = eventText
    ? `## Events\n${eventText}\n\nProcess these events and output a JSON action plan.`
    : "Check current project state and output a JSON action plan with any needed actions.";

  const history = getMonitorHistory(projectId);
  const sections = [];
  if (history) sections.push(`## Recent Monitor History\n${history}`);
  sections.push(eventSection);
  const userPrompt = sections.join("\n\n");

  // Save event message to DB (no session — monitor messages are sessionless)
  chatRepo.create(projectId, "user", eventSection);

  // Emit captain.event_received for each event so frontend can show them
  for (const event of events) {
    const description = formatEvents([event]).replace(
      /^\[\d{2}:\d{2}:\d{2}\]\s*/,
      "",
    );
    eventBus.emit("monitor.event_received", {
      project_id: projectId,
      event_type: event.type,
      description,
    });
  }

  eventBus.emit("monitor.thinking", { project_id: projectId });

  try {
    updateCaptainStatus(
      projectId,
      "thinking",
      `Analyzing ${events.length} event${events.length !== 1 ? "s" : ""}`,
    );
  } catch (err) {
    logger.warn(
      { err, projectId },
      "Monitor: Failed to update captain status to thinking",
    );
  }

  const env: Record<string, string> = {
    CREWDECK_API_URL: `http://localhost:${process.env.PORT || "9381"}`,
    CREWDECK_PROJECT_ID: projectId,
    CREWDECK_AGENT_ID: "captain",
  };

  const sshKeyPath = await setupGitHubAuth(projectId, env);
  let finalResponse = "";
  let actionPlan: ActionPlan | null = null;

  try {
    const model = resolveModel("captain");

    const result = await spawnClaudeStream({
      prompt: userPrompt,
      systemPrompt,
      workdir: ".",
      env,
      model,
    });

    // 2-minute timeout: kill the process if it hangs
    const mainTimer = setTimeout(
      () => {
        logger.warn(
          { projectId, pid: result.pid },
          "Monitor: claude -p timed out after 2 minutes, sending SIGTERM",
        );
        result.process.kill("SIGTERM");
        setTimeout(() => {
          if (!result.process.killed) result.process.kill("SIGKILL");
        }, 5000);
      },
      2 * 60 * 1000,
    );

    // Collect all events for processing
    const collectedEvents: Array<{ type: string; [key: string]: unknown }> = [];
    let resultText = "";

    for await (const event of result.events) {
      collectedEvents.push(event);

      // Emit streaming events for frontend visibility
      // Wrapped in try-catch for defensive handling of malformed events
      try {
        if (event.type === "assistant") {
          const content = event.message as
            | { content?: Array<{ text?: string }> }
            | undefined;
          const text = content?.content?.[0]?.text;
          if (text) {
            eventBus.emit("monitor.message", {
              project_id: projectId,
              content: text,
            });
          }
        } else if (event.type === "tool_use") {
          eventBus.emit("monitor.tool_call", {
            project_id: projectId,
            tool_name: (event.name as string) ?? "unknown",
            tool_input: event.input,
          });
        } else if (event.type === "tool_result") {
          eventBus.emit("monitor.tool_result", {
            project_id: projectId,
            tool_name: "bash",
            result: event.content,
          });
        } else if (event.type === "result") {
          resultText = typeof event.result === "string" ? event.result : "";
        }
      } catch (eventErr) {
        logger.warn(
          { eventErr, eventType: event.type },
          "Monitor: Failed to process stream event",
        );
      }
    }

    const exitResult = await result.exitPromise;
    clearTimeout(mainTimer);

    if (exitResult.code !== 0) {
      logger.warn(
        { projectId, code: exitResult.code },
        "Monitor claude -p exited non-zero",
      );
    }

    // Try to extract action plan from result
    if (resultText) {
      const json = extractJsonFromResponse(resultText);
      if (json) {
        actionPlan = parseActionPlan(json);
      }
    }

    // Fallback: try extracting from collected events
    if (!actionPlan) {
      actionPlan = extractActionPlanFromEvents(collectedEvents);
    }

    // If we have an action plan, execute it.
    // Note: The mutex is still held during plan execution. While the issue
    // description mentions narrowing mutex scope as an optimization, this
    // implementation keeps the mutex held for simplicity. The main performance
    // benefit comes from the LLM no longer waiting for curl responses — all
    // actions are executed after the LLM completes.
    if (actionPlan) {
      logger.info(
        {
          projectId,
          reasoning: actionPlan.reasoning,
          actionCount: actionPlan.actions.length,
        },
        "Monitor: Executing action plan",
      );

      try {
        updateCaptainStatus(
          projectId,
          "executing",
          actionPlan.reasoning
            ? actionPlan.reasoning.slice(0, 120)
            : `Executing ${actionPlan.actions.length} action${actionPlan.actions.length !== 1 ? "s" : ""}`,
        );
      } catch (err) {
        logger.warn(
          { err, projectId },
          "Monitor: Failed to update captain status to executing",
        );
      }

      const results = await executePlan(projectId, actionPlan);
      finalResponse = formatResults(results);

      if (actionPlan.reasoning) {
        finalResponse = `${actionPlan.reasoning}\n\n${finalResponse}`;
      }
    } else {
      // No valid action plan — retry with a minimal extraction prompt
      logger.warn(
        { projectId, responsePreview: (resultText || "").slice(0, 200) },
        "Monitor: Could not parse action plan, retrying extraction",
      );

      try {
        const retryResult = await spawnClaudeStream({
          prompt:
            "Extract the actions from the following text and output them as JSON wrapped in <action> tags.\n\n" +
            "Available action types: dispatch (issue_id, agent_id, instructions?), merge (issue_id), " +
            "create-pr (issue_id), comment (issue_id, content), create-issue (title, description?), " +
            "update-issue (issue_id, status?, title?), scan, skip (issue_id, reason).\n\n" +
            'If no actions are described, output: <action>{"reasoning": "no actions", "actions": []}</action>\n\n' +
            "Text to extract from:\n---\n" +
            (resultText || "No response") +
            "\n---",
          systemPrompt:
            "You extract structured actions from text. Output ONLY <action>{JSON}</action> tags. No other text.",
          workdir: ".",
          env,
          model,
        });

        // 30-second timeout for simple extraction retry
        const retryTimer = setTimeout(() => {
          logger.warn(
            { projectId, pid: retryResult.pid },
            "Monitor: retry extraction timed out after 30 seconds, sending SIGTERM",
          );
          retryResult.process.kill("SIGTERM");
          setTimeout(() => {
            if (!retryResult.process.killed)
              retryResult.process.kill("SIGKILL");
          }, 5000);
        }, 30 * 1000);

        let retryText = "";
        for await (const event of retryResult.events) {
          if (event.type === "result") {
            retryText = typeof event.result === "string" ? event.result : "";
          }
        }
        await retryResult.exitPromise;
        clearTimeout(retryTimer);

        if (retryText) {
          const retryJson = extractJsonFromResponse(retryText);
          if (retryJson) {
            actionPlan = parseActionPlan(retryJson);
          }
        }

        if (actionPlan) {
          logger.info(
            { projectId, actionCount: actionPlan.actions.length },
            "Monitor: Retry extraction succeeded",
          );
          const results = await executePlan(projectId, actionPlan);
          finalResponse = formatResults(results);
          if (actionPlan.reasoning) {
            finalResponse = `${actionPlan.reasoning}\n\n${finalResponse}`;
          }
        } else {
          finalResponse = resultText || "No action plan generated";
          logger.warn({ projectId }, "Monitor: Retry extraction also failed");
        }
      } catch (retryErr) {
        logger.error(
          { retryErr, projectId },
          "Monitor: Retry extraction failed",
        );
        finalResponse = resultText || "No action plan generated";
      }
    }
  } catch (err) {
    logger.error({ err }, "Monitor claude -p call failed");
    finalResponse = "Error: Failed to process events";
  } finally {
    if (sshKeyPath) {
      const { cleanupSshKey } = await import("../../utils/git-auth.js");
      cleanupSshKey(sshKeyPath);
    }
  }

  if (finalResponse) {
    eventBus.emit("monitor.message", {
      project_id: projectId,
      content: finalResponse,
    });
    chatRepo.create(projectId, "assistant", finalResponse);
  }

  eventBus.emit("monitor.complete", {
    project_id: projectId,
    response: finalResponse,
  });

  return finalResponse;
};
