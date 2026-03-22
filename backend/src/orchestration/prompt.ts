import type { Issue, Comment, Repo, ProjectKnowledge } from "../types/entities.js";
import { escapeXml } from "../utils/xml.js";

function formatComments(comments: Comment[]): string {
  return comments
    .map((c) => {
      const time = c.created_at.replace("T", " ").slice(0, 19);
      const author = c.author_type === "agent" ? `agent:${c.author_id ?? "unknown"}` : c.author_type;
      return `[${time}] (${author}) ${c.content}`;
    })
    .join("\n\n");
}

function formatIssueSummary(issue: Issue): string {
  return `- [${issue.status}] #${issue.id}: ${escapeXml(issue.title)}`;
}

/**
 * Agents with full API access (issues CRUD, status management, comments, activity, crew list).
 * Enforcement is via system prompts only — no server-side per-agent auth since the API is
 * localhost-only. The system prompt is the contract (see #321 "API Access Matrix").
 */
const FULL_ACCESS_AGENTS = new Set(["captain"]);

/**
 * Agents with knowledge API access (list, create, update, delete knowledge entries).
 */
const KNOWLEDGE_ACCESS_AGENTS = new Set(["librarian"]);

function buildApiSection(agentId: string): string {
  const lines: string[] = [
    "## API Reference",
    "The following environment variables are available:",
    "- CREWDECK_API_URL — base URL of the backend API",
    "- CREWDECK_PROJECT_ID — current project ID",
    "- CREWDECK_AGENT_ID — your agent ID",
    "- CREWDECK_ISSUE_ID — current issue ID",
  ];

  if (FULL_ACCESS_AGENTS.has(agentId)) {
    lines.push(
      "",
      "API endpoints (via curl):",
      "- GET $CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues — list issues",
      "- GET $CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/$CREWDECK_ISSUE_ID — get this issue",
      // Spec (#321) listed mark-pr-created/mark-done/reset-chain-depth as separate endpoints;
      // actual API uses PATCH status transitions.
      "- PATCH $CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/$CREWDECK_ISSUE_ID — update issue fields",
      "- GET $CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/$CREWDECK_ISSUE_ID/comments — list comments",
      "- GET $CREWDECK_API_URL/api/v1/crew — list available agents",
      "- GET $CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/activity — view activity log",
      "",
      "Internal API (for agent actions):",
      "- POST $CREWDECK_API_URL/api/v1/internal/comment — post a comment (body: { issue_id, project_id, agent_id, content })",
      "- POST $CREWDECK_API_URL/api/v1/internal/issues/create — create a new issue (body: { project_id, title, description, priority? })",
      "- POST $CREWDECK_API_URL/api/v1/internal/issues/update — update issue priority (body: { project_id, issue_id, priority })",
      "- POST $CREWDECK_API_URL/api/v1/internal/create-pr — register a PR for tracking (body: { project_id, issue_id, pr_url })",
    );
  } else if (KNOWLEDGE_ACCESS_AGENTS.has(agentId)) {
    lines.push(
      "",
      "Knowledge API (via curl):",
      "- GET $CREWDECK_API_URL/api/v1/internal/knowledge/list?project_id=$CREWDECK_PROJECT_ID — list knowledge entries",
      "- POST $CREWDECK_API_URL/api/v1/internal/knowledge/create — create entry (body: { project_id, title, category, content, agent_ids? })",
      "- POST $CREWDECK_API_URL/api/v1/internal/knowledge/update — update entry (body: { project_id, knowledge_id, title?, category?, content?, agent_ids? })",
      "- POST $CREWDECK_API_URL/api/v1/internal/knowledge/delete — delete entry (body: { project_id, knowledge_id })",
    );
  } else {
    // Non-captain agents don't need API access — their stdout is automatically
    // captured and posted as a comment by the backend.
    lines.push(
      "",
      "You do not have API access. Your stdout is automatically posted as a comment.",
    );
  }

  return lines.join("\n");
}

export interface BuildPromptOptions {
  issue: Issue;
  comments: Comment[];
  repo: Repo | { local_path: string; default_branch: string; name: string } | null;
  worktreePath: string;
  agentId: string;
  /** All open/in-progress issues for the project (injected for captain). */
  projectIssues?: Issue[];
  /** Knowledge entries filtered for this agent. */
  projectKnowledge?: ProjectKnowledge[];
}

export function buildPrompt(opts: BuildPromptOptions): string;
export function buildPrompt(
  issue: Issue,
  comments: Comment[],
  repo: Repo | { local_path: string; default_branch: string; name: string } | null,
  worktreePath: string,
): string;
export function buildPrompt(
  issueOrOpts: Issue | BuildPromptOptions,
  comments?: Comment[],
  repo?: Repo | { local_path: string; default_branch: string; name: string } | null,
  worktreePath?: string,
): string {
  // Normalize to options object
  let opts: BuildPromptOptions;
  if (comments !== undefined) {
    opts = {
      issue: issueOrOpts as Issue,
      comments: comments!,
      repo: repo ?? null,
      worktreePath: worktreePath!,
      agentId: "",
    };
  } else {
    opts = issueOrOpts as BuildPromptOptions;
  }

  const { issue, comments: cmts, repo: r, worktreePath: wp, agentId, projectIssues, projectKnowledge } = opts;
  const parts: string[] = [];

  parts.push(
    `## Issue\n<issue_title>\n${escapeXml(issue.title)}\n</issue_title>\n\n<issue_description>\n${escapeXml(issue.description ?? "")}\n</issue_description>`,
  );

  // Inject project knowledge entries if present
  if (projectKnowledge && projectKnowledge.length > 0) {
    const entries = projectKnowledge
      .map((k) => `### ${k.title} (${k.category})\n${k.content}`)
      .join("\n\n");
    parts.push(`## Project Knowledge\n${entries}`);
  }

  if (r)
    parts.push(`## Repository\n${escapeXml("name" in r ? r.name : "repo")} at ${escapeXml(wp)}`);

  // Captain gets all open/in-progress issues for dependency-aware scheduling
  if (agentId === "captain" && projectIssues && projectIssues.length > 0) {
    const otherIssues = projectIssues.filter((i) => i.id !== issue.id);
    if (otherIssues.length > 0) {
      parts.push(
        `## All Open/In-Progress Issues\n${otherIssues.map(formatIssueSummary).join("\n")}`,
      );
    }
  }

  if (cmts.length > 0)
    parts.push(`## Comment History\n<comments>\n${formatComments(cmts)}\n</comments>`);

  // Diff instructions
  const safeBranch = /^[a-zA-Z0-9._/-]+$/.test(issue.base_branch ?? "")
    ? issue.base_branch!
    : "main";

  const diffInstruction = r
    ? `\n\nTo see what changed, run:\n  git diff $(git merge-base HEAD origin/${safeBranch}) HEAD`
    : "";

  parts.push(buildApiSection(agentId));

  parts.push(`## Instructions
Work on the issue described above. Your entire stdout will be captured and posted as a comment on the issue.${diffInstruction}

To trigger another agent after you're done, use \`/dispatch agent-name\` at the start of a line.
For example: "/dispatch captain" followed by your summary of completed work.

Note: @mentions are cosmetic references only — they do NOT trigger agent spawns.

Do your best work.`);

  return parts.join("\n\n");
}
