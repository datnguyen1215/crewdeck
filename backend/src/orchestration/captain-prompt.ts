/**
 * Captain Prompt Builder
 *
 * Constructs the system prompt for captain terminal sessions.
 */
import { getProject } from "../db/repositories/projects.js";
import * as globalConfigRepo from "../db/repositories/global-config.js";
import { listIssues } from "../db/repositories/issues.js";
import { listActiveRunsForProject, countRunningGlobal } from "../db/repositories/agent-runs.js";
import { getCrewMember } from "./crew.js";
import { listByProject } from "../db/repositories/knowledge.js";
import { listRepos } from "../db/repositories/repos.js";

/**
 * Build the system prompt for terminal captain session.
 */
export const buildSystemPrompt = async (
  projectId: string,
  worktreePath?: string,
): Promise<string> => {
  const project = getProject(projectId);
  if (!project) return "";

  const runningAgents = countRunningGlobal();
  const maxConcurrency = globalConfigRepo.getMaxConcurrency();

  // Get project knowledge
  const projectKnowledge = listByProject(projectId);

  // Get repo info
  const repos = listRepos(projectId);
  const repo = repos.length > 0 ? repos[0] : null;

  const parts: string[] = [];

  parts.push(`You are Captain, the project assistant for CrewDeck.

## Role
You have a conversation with the user about their project. You can answer questions,
provide status updates, and take actions on their behalf (dispatch agents, create issues, etc.).

## Project: ${project.name}
${project.description || "No description"}

## Current Capacity
- Running agents: ${runningAgents}
- Max concurrency: ${maxConcurrency}
- Available slots: ${Math.max(0, maxConcurrency - runningAgents)}`);

  // Inject project knowledge (full content for workflows/conventions)
  const INJECT_CATEGORIES = new Set(["workflows", "conventions"]);
  if (projectKnowledge.length > 0) {
    const injected = projectKnowledge.filter((k) =>
      INJECT_CATEGORIES.has(k.category),
    );
    if (injected.length > 0) {
      const entries = injected
        .map((k) => `### ${k.title} (${k.category})\n${k.content}`)
        .join("\n\n");
      parts.push(`## Project Knowledge\n${entries}`);
    }
  }

  // Repository info
  if (repo && worktreePath) {
    parts.push(`## Repository\n${repo.name} at ${worktreePath}`);
  }

  // Build state snapshot
  const snapshotParts: string[] = [];

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
      return `- ${i.id} | ${i.status}${paused}${agent} | ${i.title}`;
    });
    snapshotParts.push(`### Issues (non-closed)\n${rows.join("\n")}`);
  } else {
    snapshotParts.push("### Issues (non-closed)\nNone");
  }

  const activeRuns = listActiveRunsForProject(projectId);
  if (activeRuns.length > 0) {
    const rows = activeRuns.map((r) => {
      const agent = getCrewMember(r.agent_id);
      const name = agent?.name ?? r.agent_id;
      const issue = r.issue_id ? ` on issue ${r.issue_id}` : "";
      return `- ${r.id} | ${name} (${r.status})${issue}`;
    });
    snapshotParts.push(`### Active Runs\n${rows.join("\n")}`);
  } else {
    snapshotParts.push("### Active Runs\nNone");
  }

  if (projectKnowledge.length > 0) {
    const rows = projectKnowledge.map(
      (k) => `- ${k.id} | [${k.category}] ${k.title}`,
    );
    snapshotParts.push(`### Knowledge Entries\n${rows.join("\n")}`);
  } else {
    snapshotParts.push("### Knowledge Entries\nNone");
  }

  parts.push(
    `## Current State (pre-fetched snapshot)\n${snapshotParts.join("\n\n")}\n\nThis snapshot was fetched at session start. Use curl to refresh or get details as needed.`,
  );

  // API Reference — only detail endpoints, since snapshot covers listing
  parts.push(`## API Reference
Environment variables: CREWDECK_API_URL, CREWDECK_PROJECT_ID, CREWDECK_AGENT_ID, CREWDECK_API_KEY

All API calls require authentication. Include this header:
-H "Authorization: Bearer $CREWDECK_API_KEY"

\`\`\`bash
# Full issue details
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/<ISSUE_ID>" \\
  -H "Authorization: Bearer $CREWDECK_API_KEY"

# Create issue
curl -X POST "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues" \\
  -H "Authorization: Bearer $CREWDECK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "Issue title", "description": "Description"}'

# Update issue
curl -X PUT "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/<ISSUE_ID>" \\
  -H "Authorization: Bearer $CREWDECK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"status": "done"}'

# Add comment
curl -X POST "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/<ISSUE_ID>/comments" \\
  -H "Authorization: Bearer $CREWDECK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Comment text", "author_type": "captain"}'

# Run details
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/runs/<RUN_ID>" \\
  -H "Authorization: Bearer $CREWDECK_API_KEY"

# Activity log
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/activity?limit=20&compact=true" \\
  -H "Authorization: Bearer $CREWDECK_API_KEY"

# Full knowledge entry
curl "$CREWDECK_API_URL/api/v1/internal/knowledge/get?project_id=$CREWDECK_PROJECT_ID&knowledge_id=<ID>" \\
  -H "Authorization: Bearer $CREWDECK_API_KEY"

# Dispatch agent to work on an issue
curl -X POST "$CREWDECK_API_URL/api/v1/internal/captain/dispatch-agent" \\
  -H "Authorization: Bearer $CREWDECK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id": "'$CREWDECK_PROJECT_ID'", "issue_id": "<ISSUE_ID>", "agent_id": "<AGENT_ID>"}'

# Dispatch agent with custom instructions
curl -X POST "$CREWDECK_API_URL/api/v1/internal/captain/dispatch-agent" \\
  -H "Authorization: Bearer $CREWDECK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id": "'$CREWDECK_PROJECT_ID'", "issue_id": "<ISSUE_ID>", "agent_id": "<AGENT_ID>", "instructions": "Focus on the database layer"}'

# Merge a ready PR
curl -X POST "$CREWDECK_API_URL/api/v1/internal/captain/merge-pr" \\
  -H "Authorization: Bearer $CREWDECK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id": "'$CREWDECK_PROJECT_ID'", "issue_id": "<ISSUE_ID>"}'

# Trigger codebase scan (updates project knowledge)
curl -X POST "$CREWDECK_API_URL/api/v1/internal/captain/scan-codebase" \\
  -H "Authorization: Bearer $CREWDECK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id": "'$CREWDECK_PROJECT_ID'"}'
\`\`\`

## Available Actions
You have access to server-side tools for:
- **dispatch_agent** — Spawn an agent (engineer, lead, docs, librarian) to work on an issue
- **merge_pr** — Merge a ready PR
- **scan_codebase** — Trigger librarian scan to update project knowledge
- **create_issue** — Create a new issue via the Issues API above
- **update_issue** — Update issue status via the Issues API above
- **comment** — Post comments on issues via the Issues API above

Ask clarifying questions when needed. Keep responses concise and actionable.`);

  return parts.join("\n\n");
};
