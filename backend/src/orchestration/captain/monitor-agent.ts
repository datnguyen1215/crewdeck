/**
 * Monitor LLM Agent
 *
 * Uses `claude -p` CLI to make automated orchestration decisions.
 * Handles events like issue creation, run completion, PR status changes.
 * Does not handle user chat messages — those go through chat-agent.ts.
 *
 * Uses curl to call the internal API directly for all actions.
 */
import { logger } from "../../logger.js";
import { eventBus } from "../../events/bus.js";
import { getProject } from "../../db/repositories/projects.js";
import { getActiveProcessCount } from "../processes.js";
import { spawnClaudeStream } from "../process.js";
import { resolveModel } from "../../db/repositories/agent-config.js";
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

## Available Actions
Use curl to call the CrewDeck internal API. Environment variables $CREWDECK_API_URL and $CREWDECK_PROJECT_ID are set.

### Dispatch an agent to work on an issue
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/captain/dispatch-agent" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","issue_id":"<ISSUE_ID>","agent_id":"<AGENT_ID>","instructions":"optional instructions"}'
\`\`\`
Available agents:
- \`engineer\` — writes and tests code
- \`lead\` — reviews code for correctness, security, architecture
- \`docs\` — updates documentation to match code changes
- \`librarian\` — investigates codebases, maintains knowledge entries

### Create a GitHub PR for an issue
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/captain/create-pr" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","issue_id":"<ISSUE_ID>"}'
\`\`\`

### Merge a PR
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/captain/merge-pr" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","issue_id":"<ISSUE_ID>"}'
\`\`\`

### Create an issue
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/issues/create" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","title":"Issue title","description":"Description"}'
\`\`\`

### Update an issue
\`\`\`bash
curl -X PATCH "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/<ISSUE_ID>" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"<new_status>"}'
\`\`\`

### Add a comment
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/comment" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","issue_id":"<ISSUE_ID>","agent_id":"captain","content":"Comment text"}'
\`\`\`

### Scan codebase (Librarian)
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/captain/scan-codebase" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'"}'
\`\`\`

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
- If all agents are busy, do nothing — just explain why in your response
- If waiting for CI to run, don't take action yet
- If waiting for review, let the process complete
- If an issue is blocked by dependencies, skip it and explain why

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
6. Finally, use the create-pr curl endpoint to create a GitHub PR (this also sets status to pr_created)

## Status Management
You own all issue status transitions.

### Rules:
1. **To create a PR**: Use the create-pr curl endpoint (it creates the GitHub PR and sets status to \`pr_created\` automatically)
2. **After fixing a PR** (conflicts, CI failures): Once fixes are pushed, set status back to \`pr_created\` via update-issue.
3. **Before deciding final status**: Query the issue to check for existing PRs
4. **Never leave status in \`in_progress\`** after completing work where a PR exists. Transition to \`pr_created\`.

## Constraints
- You can only manage this project
- Use curl for all actions — read and write
- Check current state before making decisions
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
          return `[${ts}] Issue created: "${data.issue.title}" (${data.issue.id})`;
        }
        case "issue.status_changed": {
          const data = e.data as { issue_id: string; from: string; to: string };
          return `[${ts}] Issue ${data.issue_id} status: ${data.from} → ${data.to}`;
        }
        case "run.completed": {
          const data = e.data as {
            agent_id: string;
            issue_id: string | null;
            status: string;
          };
          return `[${ts}] Agent ${data.agent_id} completed (${data.status})${data.issue_id ? ` on issue ${data.issue_id}` : ""}`;
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
          return `[${ts}] Issue ${data.issue_id} updated: ${changedFields || "unknown fields"}`;
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
          return `[${ts}] Comment on issue ${data.comment.issue_id} by ${data.comment.author_type}: ${preview}`;
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
 * Process monitor events with the LLM via claude -p with streaming.
 * The LLM executes actions directly via curl during its turn.
 */
export const processWithLLM = async (
  projectId: string,
  events: CaptainEvent[],
): Promise<string> => {
  const systemPrompt = buildSystemPrompt(projectId);
  if (!systemPrompt) return "Error: Project not found";

  const eventText = formatEvents(events);
  const eventSection = eventText
    ? `## Events\n${eventText}\n\nProcess these events and take appropriate actions using curl.`
    : "Check current project state and take any needed actions using curl.";

  const history = getMonitorHistory(projectId);
  const sections = [];
  if (history) sections.push(`## Recent Monitor History\n${history}`);
  sections.push(eventSection);
  const userPrompt = sections.join("\n\n");

  chatRepo.create(projectId, "user", eventSection);

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

  try {
    const model = resolveModel(projectId, "captain");

    const result = await spawnClaudeStream({
      prompt: userPrompt,
      systemPrompt,
      workdir: ".",
      env,
      model,
    });

    let resultText = "";

    for await (const event of result.events) {
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

    await result.exitPromise;
    finalResponse = resultText || "No response";
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
