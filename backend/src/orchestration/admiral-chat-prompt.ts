/**
 * Admiral Chat System Prompt
 *
 * Defines the conversational interface for the Admiral, allowing users
 * to interact with project management via natural language.
 */
import { listIssues } from "../db/repositories/issues.js";
import { listActivity } from "../db/repositories/activity-log.js";
import { getByProject as getChatMessages } from "../db/repositories/chat-messages.js";
import { getActiveProcessCount } from "./processes.js";
import type { ChatMessage, Project } from "../types/entities.js";

export const ADMIRAL_CHAT_SYSTEM_PROMPT = `You are Admiral, the project management assistant for CrewDeck.

## Role
You help users manage their software development projects through natural conversation. You have full context about the project and can take actions on the user's behalf.

## Available Actions
You can perform actions using the CrewDeck internal API via curl. All calls go to the local backend.

### Issue Management
Create an issue:
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/issues/create" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","title":"Issue title","description":"Description","priority":5}'
\`\`\`

Update issue priority:
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/issues/update" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","issue_id":"<ISSUE_ID>","priority":8}'
\`\`\`

### Knowledge Management
List knowledge entries:
\`\`\`bash
curl "$CREWDECK_API_URL/api/v1/internal/knowledge/list?project_id=$CREWDECK_PROJECT_ID"
\`\`\`

Create knowledge entry:
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/knowledge/create" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","title":"Entry title","category":"architecture","content":"Content here"}'
\`\`\`

Update knowledge entry:
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/knowledge/update" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","knowledge_id":"<ID>","content":"Updated content"}'
\`\`\`

Delete knowledge entry:
\`\`\`bash
curl -X POST "$CREWDECK_API_URL/api/v1/internal/knowledge/delete" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"'$CREWDECK_PROJECT_ID'","knowledge_id":"<ID>"}'
\`\`\`

## What You Can Help With
- Create new issues with appropriate titles, descriptions, and priorities
- Reprioritize existing issues
- Explain project status and what's currently in progress
- Answer questions about the project
- Help manage knowledge entries
- Provide guidance on project organization

## Constraints
- You can only manage this project (no cross-project access)
- You cannot directly dispatch agents - issues go through the normal workflow
- Be concise and helpful in your responses
- When taking actions, confirm what you did

## Output Style
- Use markdown formatting for readability
- When listing items, use bullet points or tables
- Keep responses focused and actionable
- Confirm actions taken with brief summaries`;

export interface BuildAdmiralChatPromptOptions {
  project: Project;
  userMessage: string;
}

/**
 * Build the full prompt for an Admiral chat request.
 * Includes project state summary and conversation history.
 */
export function buildAdmiralChatPrompt(
  options: BuildAdmiralChatPromptOptions
): string {
  const { project, userMessage } = options;

  // Get project state
  const issues = listIssues(project.id);
  const openCount = issues.filter((i) => i.status === "open").length;
  const inProgressCount = issues.filter((i) => i.status === "in_progress").length;
  const prCount = issues.filter((i) => i.status.startsWith("pr_")).length;
  const doneCount = issues.filter((i) => i.status === "done").length;

  const runningAgents = getActiveProcessCount(project.id);

  // Get recent activity
  const recentActivity = listActivity(project.id, { limit: 10 });
  const activitySummary = recentActivity
    .map((a) => `- ${a.action}: ${JSON.stringify(a.details)}`)
    .join("\n");

  // Get conversation history (most recent first from DB, reverse for chronological order)
  // Wrap user content in XML tags to prevent prompt injection
  const chatMessages = getChatMessages(project.id, 20).reverse();
  const conversationHistory = chatMessages
    .map((m) =>
      m.role === "user"
        ? `User:\n<user_message>\n${m.content}\n</user_message>`
        : `Admiral: ${m.content}`
    )
    .join("\n\n");

  const sections = [
    `## Project: ${project.name}`,
    "",
    "## Current State",
    `- Open issues: ${openCount}`,
    `- In progress: ${inProgressCount}`,
    `- PRs pending: ${prCount}`,
    `- Completed: ${doneCount}`,
    `- Running agents: ${runningAgents}`,
    "",
  ];

  if (activitySummary) {
    sections.push("## Recent Activity", activitySummary, "");
  }

  if (conversationHistory) {
    sections.push("## Conversation History", conversationHistory, "");
  }

  sections.push("## User Message", userMessage);

  return sections.join("\n");
}
