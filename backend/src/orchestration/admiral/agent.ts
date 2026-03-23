/**
 * Admiral LLM Agent
 *
 * Uses `claude -p` CLI to make project management decisions.
 * Maintains a persistent conversation per project.
 */
import { logger } from "../../logger.js";
import { eventBus } from "../../events/bus.js";
import { getProject } from "../../db/repositories/projects.js";
import { listIssues } from "../../db/repositories/issues.js";
import { listByProject as listKnowledge } from "../../db/repositories/knowledge.js";
import { getActiveProcessCount } from "../processes.js";
import { spawnClaude, spawnClaudeMultimodal } from "../process.js";

import * as chatRepo from "../../db/repositories/chat-messages.js";
import type { AdmiralEvent, ChatImage } from "./queue.js";

const MAX_CONTEXT_MESSAGES = 100;

/**
 * Build the system prompt for Admiral, including tool docs as curl commands.
 */
const buildSystemPrompt = (projectId: string): string => {
  const project = getProject(projectId);
  if (!project) return "";

  const issues = listIssues(projectId);
  const openIssues = issues.filter((i) => i.status === "open");
  const inProgressIssues = issues.filter((i) => i.status === "in_progress");
  const prIssues = issues.filter((i) => i.status.startsWith("pr_"));
  const doneIssues = issues.filter((i) => i.status === "done").slice(0, 20);
  const runningAgents = getActiveProcessCount(projectId);

  const knowledge = listKnowledge(projectId);
  const knowledgeSummary = knowledge
    .slice(0, 10)
    .map((k) => `- ${k.title} (${k.category})`)
    .join("\n");

  return `You are Admiral, the autonomous project orchestrator for CrewDeck.

## Role
You manage a software development project by reacting to events and making decisions.
You can merge PRs, dispatch agents to work on issues, create new issues, and manage project knowledge.

## Project: ${project.name}
${project.description || "No description"}

## Current State
- Open issues: ${openIssues.length}
- In progress: ${inProgressIssues.length}
- PRs pending: ${prIssues.length}
- Done (recent): ${doneIssues.length}
- Running agents: ${runningAgents}
- Max concurrency: ${project.max_concurrency}

## Open Issues
${openIssues.map((i) => `- [${i.id.slice(0, 8)}] ${i.title}`).join("\n") || "None"}

## In Progress Issues
${inProgressIssues.map((i) => `- [${i.id.slice(0, 8)}] ${i.title} (agent: ${i.running_agent_id || "none"})`).join("\n") || "None"}

## PR Issues
${prIssues.map((i) => `- [${i.id.slice(0, 8)}] ${i.title} (${i.status})`).join("\n") || "None"}

## Knowledge Entries
${knowledgeSummary || "None"}

## Available Actions
Use curl to call the CrewDeck internal API. Environment variables $CREWDECK_API_URL and $CREWDECK_PROJECT_ID are set.

### Merge a PR
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/admiral/merge-pr" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","issue_id":"<ISSUE_ID>"}'
\`\`\`

### Dispatch an agent to work on an issue
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/admiral/dispatch-agent" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","issue_id":"<ISSUE_ID>","agent_id":"<AGENT_ID>","instructions":"optional instructions"}'
\`\`\`
Available agents:
- \`engineer\` — writes and tests code
- \`lead\` — reviews code for correctness, security, architecture
- \`docs\` — updates documentation to match code changes
- \`librarian\` — investigates codebases, maintains knowledge entries

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
  -d '{"status":"<new_status>","title":"optional new title"}'
\`\`\`

### Get issue details
\`\`\`bash
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/<ISSUE_ID>"
\`\`\`

### List issues
\`\`\`bash
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues"
\`\`\`

### Add a comment
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/comment" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","issue_id":"<ISSUE_ID>","agent_id":"admiral","content":"Comment text"}'
\`\`\`

### Scan codebase (Librarian)
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/admiral/scan-codebase" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'"}'
\`\`\`

### Knowledge Management
\`\`\`bash
# List
curl "$CREWDECK_API_URL/api/v1/internal/knowledge/list?project_id=$CREWDECK_PROJECT_ID"

# Create
curl -X POST "$CREWDECK_API_URL/api/v1/internal/knowledge/create" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","title":"Title","category":"architecture","content":"Content"}'

# Update
curl -X POST "$CREWDECK_API_URL/api/v1/internal/knowledge/update" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","knowledge_id":"<ID>","content":"Updated content"}'

# Delete
curl -X POST "$CREWDECK_API_URL/api/v1/internal/knowledge/delete" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","knowledge_id":"<ID>"}'
\`\`\`

## Decision Guidelines

### Priority Order
1. **Merge ready PRs** - If a PR is in pr_ready_to_merge status, merge it immediately
2. **Fix broken PRs** - If a PR has conflicts or failed CI, dispatch engineer to fix
3. **Start new work** - If capacity allows, dispatch appropriate agents on open issues

### Task-Type Reasoning
Analyze each issue and decide which agents to dispatch based on the task:
- **Research/investigation** → dispatch librarian first, then engineer with findings
- **Docs-only task** → dispatch docs directly
- **Code change** → dispatch engineer, then lead for review, iterate until clean, then docs, then create PR
- **Simple fix** → dispatch engineer, maybe skip lead for trivial changes, then PR
- **Bug investigation** → dispatch librarian to explore, then engineer to fix

Do NOT follow a fixed workflow. Reason about what the issue needs.

### When to Dispatch
- Only dispatch if running agents < max_concurrency
- Don't dispatch if an agent is already running on that issue
- For conflicts/failures, include instructions about what to fix
- After an agent completes, read their report and decide the next step

### When to Wait
- If all agents are busy, wait for capacity
- If waiting for CI to run, don't take action yet
- If waiting for review, let the process complete

### Auto-Dispatch Rules
- New issues: Evaluate priority and start work if capacity allows
- Completed work: Check if next steps are needed

## Code Review Loop
When engineer completes work:
1. Dispatch lead for a full code review
2. If lead finds issues: send ALL findings to engineer with clear fix instructions
3. When engineer fixes: dispatch lead again for another full review
4. Repeat until lead reports "No issues found"
5. Then dispatch docs to update documentation
6. Finally, create the PR

## Creating Pull Requests
When lead reports a clean review and docs has finished:
1. Use the \`gh\` CLI to create the PR from the worktree directory. The worktree path is available from the issue details.
2. Register the PR for tracking:
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/create-pr" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","issue_id":"<ISSUE_ID>","pr_url":"<PR_URL>"}'
\`\`\`
3. Update the issue status to pr_created.

## Status Management
You own all issue status transitions.

### Rules:
1. **After creating a PR**: Set status to \`pr_created\`:
\`\`\`bash
curl -X PATCH "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/<ISSUE_ID>" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"pr_created"}'
\`\`\`
2. **After fixing a PR** (conflicts, CI failures): Once fixes are pushed, set status back to \`pr_created\`.
3. **Before deciding final status**: Query the issue to check for existing PRs:
\`\`\`bash
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/<ISSUE_ID>"
\`\`\`
The response includes \`issue_prs\` array. If non-empty, a PR exists.
4. **Never leave status in \`in_progress\`** after completing work where a PR exists. Transition to \`pr_created\`.

## Response Style
- Be concise and action-oriented
- When you take actions, briefly explain why
- Use markdown for formatting
- Show tool results clearly

## Constraints
- You can only manage this project
- Use curl to call the API for all actions
- Don't make assumptions about external systems`;
};

/**
 * Format events for the LLM.
 */
const formatEvents = (events: AdmiralEvent[]): string => {
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
          const data = e.data as { agent_id: string; issue_id: string | null; status: string };
          return `[${ts}] Agent ${data.agent_id} completed (${data.status})${data.issue_id ? ` on issue ${data.issue_id.slice(0, 8)}` : ""}`;
        }
        case "pr.status_changed": {
          const data = e.data as { pr_id: string; from: string; to: string };
          return `[${ts}] PR status: ${data.from} → ${data.to}`;
        }
        case "chat.message": {
          const data = e.data as { content: string };
          return `[${ts}] User message: ${data.content}`;
        }
        case "idle.check":
          return `[${ts}] Idle check: checking for stuck issues`;
        default:
          return `[${ts}] Event: ${e.type}`;
      }
    })
    .join("\n");
};

/**
 * Get conversation history from DB as text for the prompt.
 * Past images are replaced with [image attached] to save tokens.
 */
const getConversationHistory = (projectId: string): string => {
  const messages = chatRepo.getChatOnly(projectId, MAX_CONTEXT_MESSAGES).reverse();
  if (messages.length === 0) return "";

  return messages
    .map((m) => {
      if (m.role === "user") {
        const imageNote = m.images && m.images.length > 0
          ? `\n[${m.images.length} image${m.images.length > 1 ? "s" : ""} attached]`
          : "";
        return `User:\n<user_message>\n${m.content}${imageNote}\n</user_message>`;
      }
      return `Admiral: ${m.content}`;
    })
    .join("\n\n");
};

/**
 * Collect images from events (only chat.message events have images).
 */
const collectImages = (events: AdmiralEvent[]): ChatImage[] => {
  const images: ChatImage[] = [];
  for (const event of events) {
    if (event.type === "chat.message" && event.images) {
      images.push(...event.images);
    }
  }
  return images;
};

/**
 * Process events with the Admiral LLM via claude -p.
 * Returns the assistant's text response.
 */
export const processWithLLM = async (
  projectId: string,
  events: AdmiralEvent[]
): Promise<string> => {
  const systemPrompt = buildSystemPrompt(projectId);
  if (!systemPrompt) return "Error: Project not found";

  // Build user prompt from events and history
  const eventText = formatEvents(events);
  const eventSection = eventText
    ? `## Events\n${eventText}\n\nProcess these events and take appropriate actions.`
    : "Check current project state and take any needed actions.";

  const history = getConversationHistory(projectId);
  const sections = [];
  if (history) sections.push(`## Conversation History\n${history}`);
  sections.push(eventSection);
  const userPrompt = sections.join("\n\n");

  // Collect images from events
  const images = collectImages(events);

  // Save event message to DB (as 'event' type so it's not loaded in history)
  chatRepo.create(projectId, "user", eventSection, "event");

  // Emit admiral.event_received for each event so frontend can show them
  for (const event of events) {
    const description = formatEvents([event]).replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "");
    eventBus.emit("admiral.event_received", {
      project_id: projectId,
      event_type: event.type,
      description,
    });
  }

  // Emit that Admiral is thinking
  eventBus.emit("admiral.thinking", { project_id: projectId });

  const project = getProject(projectId);
  const env: Record<string, string> = {
    CREWDECK_API_URL: `http://localhost:${process.env.PORT || "9381"}`,
    CREWDECK_PROJECT_ID: projectId,
    CREWDECK_AGENT_ID: "admiral",
  };

  // Admiral needs GH_TOKEN for merge operations done via the API
  if (project?.github_account_id) {
    const { getGitHubAccount } = await import("../../db/repositories/github-accounts.js");
    const account = getGitHubAccount(project.github_account_id);
    if (account) env.GH_TOKEN = account.oauth_token;
  }

  let finalResponse = "";

  try {
    let code: number;
    let stdout: string;

    if (images.length > 0) {
      // Use multimodal spawner when images are present
      const result = await spawnClaudeMultimodal({
        text: eventSection,
        images,
        history: history || undefined,
        systemPrompt,
        workdir: ".",
        env,
      });
      const exitResult = await result.exitPromise;
      code = exitResult.code;
      stdout = exitResult.stdout;
    } else {
      // Use standard spawner for text-only messages
      const result = await spawnClaude({
        prompt: userPrompt,
        systemPrompt,
        workdir: ".",
        env,
      });
      const exitResult = await result.exitPromise;
      code = exitResult.code;
      stdout = exitResult.stdout;
    }

    if (code !== 0) {
      logger.warn({ projectId, code }, "Admiral claude -p exited non-zero");
    }

    // Parse the JSON output from claude -p --output-format json
    // Output is an array of protocol messages; find the result object
    try {
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) {
        const resultObj = parsed.find((obj) => obj.type === "result");
        finalResponse = resultObj?.result ?? stdout;
      } else {
        finalResponse = parsed.result ?? stdout;
      }
    } catch {
      // If not valid JSON, use raw output
      finalResponse = stdout;
    }
  } catch (err) {
    logger.error({ err }, "Admiral claude -p call failed");
    finalResponse = "Error: Failed to process events";
  }

  // Emit final message
  if (finalResponse) {
    eventBus.emit("admiral.message", {
      project_id: projectId,
      content: finalResponse,
    });
    chatRepo.create(projectId, "assistant", finalResponse, "chat");
  }

  // Emit completion
  eventBus.emit("admiral.complete", {
    project_id: projectId,
    response: finalResponse,
  });

  return finalResponse;
};
