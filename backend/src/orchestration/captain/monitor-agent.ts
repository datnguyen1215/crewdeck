/**
 * Monitor LLM Agent
 *
 * Uses `claude -p` CLI to make automated orchestration decisions.
 * Handles events like issue creation, run completion, PR status changes.
 * Does not handle user chat messages — those go through chat-agent.ts.
 *
 * Outputs structured action plans that the backend executes deterministically.
 */
import { logger } from "../../logger.js";
import { eventBus } from "../../events/bus.js";
import { getProject } from "../../db/repositories/projects.js";
import { getActiveProcessCount } from "../processes.js";
import { spawnClaudeStream } from "../process.js";
import { parseActionPlan, extractJsonFromResponse } from "./action-schema.js";
import { executePlan, formatResults } from "./plan-executor.js";
import type { ActionPlan } from "./action-schema.js";

import * as chatRepo from "../../db/repositories/chat-messages.js";
import type { CaptainEvent } from "./queue.js";

/**
 * Build the system prompt for Monitor — focused on orchestration decisions.
 */
const buildSystemPrompt = (projectId: string): string => {
  const project = getProject(projectId);
  if (!project) return "";

  const runningAgents = getActiveProcessCount(projectId);

  const canAutoStart = project.auto_start;
  const canMerge = project.auto_merge;

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

## Getting Current State (Read-Only)
Use curl to fetch current data before making decisions:

### List issues
\`\`\`bash
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues"
\`\`\`

### Get issue details
\`\`\`bash
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/<ISSUE_ID>"
\`\`\`

### List knowledge
\`\`\`bash
curl "$CREWDECK_API_URL/api/v1/internal/knowledge/list?project_id=$CREWDECK_PROJECT_ID"
\`\`\`

## Action Plan Output

After gathering information, output a JSON action plan. The system will execute all actions deterministically.

**IMPORTANT**: Your final response MUST be a JSON object in this exact format:

\`\`\`json
{
  "reasoning": "Brief explanation of your decisions",
  "actions": [
    { "type": "dispatch", "issue_id": "<id>", "agent_id": "engineer", "instructions": "optional instructions" },
    { "type": "dispatch", "issue_id": "<id>", "agent_id": "lead" },
    { "type": "merge", "issue_id": "<id>" },
    { "type": "comment", "issue_id": "<id>", "content": "Comment text" },
    { "type": "create-issue", "title": "Title", "description": "Description" },
    { "type": "update-issue", "issue_id": "<id>", "status": "pr_created" },
    { "type": "scan" },
    { "type": "skip", "issue_id": "<id>", "reason": "Why skipping" }
  ]
}
\`\`\`

### Action Types
| Type | Required Fields | Description |
|------|-----------------|-------------|
| dispatch | issue_id, agent_id | Dispatch agent (engineer/lead/docs/librarian) to work on issue |
| merge | issue_id | Merge the PR for an issue |
| comment | issue_id, content | Add a comment to an issue |
| create-issue | title | Create a new issue (description optional) |
| update-issue | issue_id | Update issue status/title |
| scan | (none) | Trigger librarian codebase scan |
| skip | issue_id, reason | Skip an issue (logged for observability) |

### Parallel Execution
List ALL dispatch actions needed. The system handles capacity limits and executes dispatches in parallel.
If 3 issues need work and 5 slots are available, list all 3 dispatches — they'll run simultaneously.

## Decision Guidelines

### Priority Order
1. ${canMerge ? "**Merge ready PRs** - If a PR is in pr_ready_to_merge status, merge it immediately" : "**Report ready PRs** - If a PR is in pr_ready_to_merge status, note they are ready for manual merge"}
2. **Fix broken PRs** - If a PR has conflicts or failed CI, dispatch engineer to fix
3. **Update knowledge** - If a merged PR changed project structure, trigger a librarian scan
4. **Start new work** - If capacity allows, dispatch appropriate agents on open issues

### Knowledge Maintenance
After an issue reaches \`done\` (PR merged), evaluate whether the changes warrant a librarian rescan. Use the issue title, description, and agent reports to decide.

**Trigger a scan when:**
- New files or directories were added
- Modules were restructured or renamed
- APIs were added or significantly changed
- Configuration patterns changed
- Build or deploy workflows were modified
- New architectural patterns were introduced

**Skip the scan when:**
- Bug fixes that don't change structure
- Style or formatting changes
- Dependency updates
- Documentation-only changes
- Test additions that don't reflect new architecture

### Task-Type Reasoning
Analyze each issue and decide which agents to dispatch based on the task:
- **Research/investigation** → dispatch librarian first, then engineer with findings
- **Docs-only task** → dispatch docs directly
- **Code change** → dispatch engineer, then lead for review, iterate until clean, then docs, then create PR
- **Simple fix** → dispatch engineer, maybe skip lead for trivial changes, then PR
- **Bug investigation** → dispatch librarian to explore, then engineer to fix

Do NOT follow a fixed workflow. Reason about what the issue needs.

### Issue Dependencies
Before dispatching work on any issue, check its description for dependency references:
- Look for phrases like "depends on #", "blocked by #", "requires #", "after #", "waiting on #"
- If a blocking issue is not yet in \`done\` or \`pr_created\` status, **skip** the blocked issue — do not dispatch agents for it
- Work on unblocked issues instead
- When you receive completion or merge events (issue status changing to \`done\`, \`pr_created\`, or a PR merge), re-evaluate any previously skipped issues whose blockers may now be resolved
- If all available issues are blocked, wait rather than starting work that will conflict

### When to Dispatch
- You can dispatch multiple agents if slots are available — list all needed dispatches
- Don't dispatch if an agent is already running on that issue
- Don't dispatch if the issue is blocked by unfinished dependencies (see above)
- For conflicts/failures, include instructions about what to fix
- After an agent completes, read their report and decide the next step

### When to Wait
- If all agents are busy, output an empty actions array with reasoning
- If waiting for CI to run, don't take action yet
- If waiting for review, let the process complete
- If an issue is blocked by dependencies, use skip action with reason

### Auto-Dispatch Rules
- **issue.created events**: ${canAutoStart ? "Automatically dispatch an agent to work on the new issue. Do NOT create a new issue — one already exists." : "Do NOT automatically dispatch agents on new issues. Wait for the user to trigger dispatch via the UI or chat. Just acknowledge the new issue."}
- **Completed work**: Always check if next steps are needed (review, docs, PR creation, etc.) regardless of auto_start setting.

## Code Review Loop
When engineer completes work:
1. Dispatch lead for a full code review
2. If lead finds issues: send ALL findings to engineer with clear fix instructions
3. When engineer fixes: dispatch lead again for another full review
4. Repeat until lead reports "No issues found"
5. Then dispatch docs to update documentation
6. Finally, update the issue status to pr_created

## Status Management
You own all issue status transitions.

### Rules:
1. **After creating a PR**: Use update-issue action with status \`pr_created\`
2. **After fixing a PR** (conflicts, CI failures): Once fixes are pushed, set status back to \`pr_created\`.
3. **Before deciding final status**: Query the issue to check for existing PRs
4. **Never leave status in \`in_progress\`** after completing work where a PR exists. Transition to \`pr_created\`.

## Constraints
- You can only manage this project
- Use curl only for READ operations (list issues, get issue, list knowledge)
- All WRITE operations must be in the action plan JSON
- Don't make assumptions about external systems${!canMerge ? "\n- You cannot merge PRs. Auto-merge is disabled for this project." : ""}${!canAutoStart ? "\n- You cannot automatically start work on new issues. Auto-start is disabled — wait for user to dispatch." : ""}`;
};

/**
 * Format events for the LLM.
 */
export const formatEvents = (events: CaptainEvent[]): string => {
  if (events.length === 0) return "";

  return events
    .map((e) => {
      const ts = e.timestamp.toISOString().slice(11, 19);
      switch (e.type) {
        case "issue.created": {
          const data = e.data as { issue: { title: string; id: string } };
          return `[${ts}] Issue created: "${data.issue.title}" (${data.issue.id.slice(0, 8)})`;
        }
        case "issue.status_changed": {
          const data = e.data as { issue_id: string; from: string; to: string };
          return `[${ts}] Issue ${data.issue_id.slice(0, 8)} status: ${data.from} → ${data.to}`;
        }
        case "run.completed": {
          const data = e.data as {
            agent_id: string;
            issue_id: string | null;
            status: string;
          };
          return `[${ts}] Agent ${data.agent_id} completed (${data.status})${data.issue_id ? ` on issue ${data.issue_id.slice(0, 8)}` : ""}`;
        }
        case "pr.status_changed": {
          const data = e.data as { pr_id: string; from: string; to: string };
          return `[${ts}] PR status: ${data.from} → ${data.to}`;
        }
        case "issue.updated": {
          const data = e.data as {
            issue_id: string;
            changes: Record<string, unknown>;
          };
          const changedFields = Object.keys(data.changes || {}).join(", ");
          return `[${ts}] Issue ${data.issue_id.slice(0, 8)} updated: ${changedFields || "unknown fields"}`;
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
          const preview =
            data.comment.content.length > 200
              ? data.comment.content.slice(0, 200) + "…"
              : data.comment.content;
          return `[${ts}] Comment on issue ${data.comment.issue_id.slice(0, 8)} by ${data.comment.author_type}: ${preview}`;
        }
        case "run.recovered": {
          const data = e.data as {
            issue_id: string;
            failed_agent_id: string;
          };
          return `[${ts}] Run recovered: agent ${data.failed_agent_id} failed on issue ${data.issue_id.slice(0, 8)}, ready for retry`;
        }
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
    .join("\n");
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
    .map((m) => {
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
  if (!project?.github_account_id) return undefined;

  const { getGitHubAccount } =
    await import("../../db/repositories/github-accounts.js");
  const account = getGitHubAccount(project.github_account_id);
  if (!account) return undefined;

  env.GH_TOKEN = account.gh_token;
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

  const env: Record<string, string> = {
    CREWDECK_API_URL: `http://localhost:${process.env.PORT || "9381"}`,
    CREWDECK_PROJECT_ID: projectId,
    CREWDECK_AGENT_ID: "captain",
  };

  const sshKeyPath = await setupGitHubAuth(projectId, env);
  let finalResponse = "";
  let actionPlan: ActionPlan | null = null;

  try {
    const result = await spawnClaudeStream({
      prompt: userPrompt,
      systemPrompt,
      workdir: ".",
      env,
    });

    // Collect all events for processing
    const collectedEvents: Array<{ type: string; [key: string]: unknown }> = [];
    let resultText = "";

    for await (const event of result.events) {
      collectedEvents.push(event);

      // Emit streaming events for frontend visibility
      // Wrapped in try-catch for defensive handling of malformed events
      try {
        if (event.type === "assistant") {
          const content = event.message as { content?: Array<{ text?: string }> } | undefined;
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
        logger.warn({ eventErr, eventType: event.type }, "Monitor: Failed to process stream event");
      }
    }

    const exitResult = await result.exitPromise;

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

      const results = await executePlan(projectId, actionPlan);
      finalResponse = formatResults(results);

      if (actionPlan.reasoning) {
        finalResponse = `${actionPlan.reasoning}\n\n${finalResponse}`;
      }
    } else if (resultText) {
      // No valid action plan, use raw response
      finalResponse = resultText;
      logger.warn(
        { projectId, responsePreview: resultText.slice(0, 200) },
        "Monitor: Could not parse action plan from response",
      );
    } else {
      finalResponse = "No action plan generated";
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
