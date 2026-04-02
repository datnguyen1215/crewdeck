import type {
  Issue,
  Comment,
  Repo,
  ProjectKnowledge,
} from "../types/entities.js";
import { escapeXml } from "../utils/xml.js";

/** Max characters for truncated older agent comments. */
const AGENT_COMMENT_TRUNCATE = 200;

/**
 * Format comments for agent prompts with trimming to reduce token usage.
 *
 * - User comments are always included in full (they contain instructions).
 * - The most recent comment per agent type is included in full.
 * - Older agent comments are truncated to a short preview.
 */
function formatComments(comments: Comment[]): string {
  // Find the index of the last comment per agent author_type
  const lastByAgent = new Map<string, number>();
  for (let i = 0; i < comments.length; i++) {
    if (comments[i].author_type !== "user") {
      lastByAgent.set(comments[i].author_type, i);
    }
  }

  return comments
    .map((c, i) => {
      const time = c.created_at.replace("T", " ").slice(0, 19);
      const isUser = c.author_type === "user";
      const isLatestForAgent = lastByAgent.get(c.author_type) === i;

      if (isUser || isLatestForAgent) {
        return `[${time}] (${c.author_type}) ${c.content}`;
      }

      // Truncate older agent comments
      const preview =
        c.content.length > AGENT_COMMENT_TRUNCATE
          ? c.content.slice(0, AGENT_COMMENT_TRUNCATE) + "… (truncated)"
          : c.content;
      return `[${time}] (${c.author_type}) ${preview}`;
    })
    .join("\n\n");
}

/**
 * Agents with knowledge write API access (create, update, delete knowledge entries).
 */
const KNOWLEDGE_WRITE_AGENTS = new Set(["librarian"]);

function buildApiSection(agentId: string): string {
  const lines: string[] = [
    "## API Reference",
    "The following environment variables are available:",
    "- CREWDECK_API_URL — base URL of the backend API",
    "- CREWDECK_PROJECT_ID — current project ID",
    "- CREWDECK_AGENT_ID — your agent ID",
    "- CREWDECK_ISSUE_ID — current issue ID",
    "- CREWDECK_API_KEY — system API key for authentication",
    "",
    "All API calls require authentication. Use this header:",
    '-H "Authorization: Bearer $CREWDECK_API_KEY"',
    "",
    "Knowledge API (read-only, via curl):",
    "- GET $CREWDECK_API_URL/api/v1/internal/knowledge/titles?project_id=$CREWDECK_PROJECT_ID — list available knowledge entries (returns id, title, category)",
    "- GET $CREWDECK_API_URL/api/v1/internal/knowledge/get?project_id=$CREWDECK_PROJECT_ID&knowledge_id=<ID> — get full content of a knowledge entry",
  ];

  if (KNOWLEDGE_WRITE_AGENTS.has(agentId)) {
    lines.push(
      "",
      "Knowledge API (write, via curl):",
      "- POST $CREWDECK_API_URL/api/v1/internal/knowledge/create — create entry (body: { project_id, title, category, content })",
      "- POST $CREWDECK_API_URL/api/v1/internal/knowledge/update — update entry (body: { project_id, knowledge_id, title?, category?, content? })",
      "- POST $CREWDECK_API_URL/api/v1/internal/knowledge/delete — delete entry (body: { project_id, knowledge_id })",
    );
  } else {
    lines.push(
      "",
      "Your stdout is automatically posted as a comment on the issue.",
    );
  }

  return lines.join("\n");
}

export interface BuildPromptOptions {
  issue: Issue;
  comments: Comment[];
  repo:
    | Repo
    | { local_path: string; default_branch: string; name: string }
    | null;
  worktreePath: string;
  agentId: string;
  /** Knowledge entries filtered for this agent. */
  projectKnowledge?: ProjectKnowledge[];
}

export interface BuildScanPromptOptions {
  repo: Repo | { local_path: string; name: string } | null;
  repoPath: string;
  projectKnowledge?: ProjectKnowledge[];
}

export function buildPrompt(opts: BuildPromptOptions): string {
  const { issue, comments, repo, worktreePath, agentId, projectKnowledge } =
    opts;
  const parts: string[] = [];

  parts.push(
    `## Issue\n<issue_title>\n${escapeXml(issue.title)}\n</issue_title>\n\n<issue_description>\n${escapeXml(issue.description ?? "")}\n</issue_description>`,
  );

  // List available knowledge entries (titles only — agents fetch content on demand)
  const INJECT_CATEGORIES = new Set(["workflows", "conventions"]);
  if (projectKnowledge && projectKnowledge.length > 0) {
    const relevant = projectKnowledge.filter((k) =>
      INJECT_CATEGORIES.has(k.category),
    );
    if (relevant.length > 0) {
      const listing = relevant
        .map((k) => `- [${k.category}] ${k.title} (id: ${k.id})`)
        .join("\n");
      parts.push(
        `## Project Knowledge\nThe following knowledge entries are available. Fetch any you need before starting work using the knowledge API.\n${listing}`,
      );
    }
  }

  if (repo)
    parts.push(
      `## Repository\n${escapeXml("name" in repo ? repo.name : "repo")} at ${escapeXml(worktreePath)}`,
    );

  if (comments.length > 0)
    parts.push(
      `## Comment History\n<comments>\n${formatComments(comments)}\n</comments>`,
    );

  // Diff instructions
  const safeBranch = /^[a-zA-Z0-9._/-]+$/.test(issue.base_branch ?? "")
    ? issue.base_branch!
    : "main";

  const diffInstruction = repo
    ? `\n\nTo see what changed, run:\n  git diff $(git merge-base HEAD origin/${safeBranch}) HEAD`
    : "";

  parts.push(buildApiSection(agentId));

  parts.push(`## Instructions
Work on the issue described above. Your entire stdout will be captured and posted as a comment on the issue.${diffInstruction}

Note: @mentions are cosmetic references only — they do NOT trigger agent spawns.

Do your best work.`);

  return parts.join("\n\n");
}

/**
 * Build a prompt for librarian scan (no issue context).
 */
export function buildScanPrompt(opts: BuildScanPromptOptions): string {
  const { repo, repoPath, projectKnowledge } = opts;
  const parts: string[] = [];

  parts.push(
    "## Task\nScan the codebase and update knowledge entries for this project.",
  );

  // List existing knowledge entries (titles only — librarian fetches content on demand)
  if (projectKnowledge && projectKnowledge.length > 0) {
    const listing = projectKnowledge
      .map((k) => `- [${k.category}] ${k.title} (id: ${k.id})`)
      .join("\n");
    parts.push(
      `## Existing Knowledge\nThe following knowledge entries exist. Fetch any you need to review before creating or updating entries.\n${listing}`,
    );
  }

  if (repo)
    parts.push(
      `## Repository\n${escapeXml("name" in repo ? repo.name : "repo")} at ${escapeXml(repoPath)}`,
    );

  // Librarian-specific API section
  parts.push(`## API Reference
The following environment variables are available:
- CREWDECK_API_URL — base URL of the backend API
- CREWDECK_PROJECT_ID — current project ID
- CREWDECK_AGENT_ID — your agent ID
- CREWDECK_API_KEY — system API key for authentication

All API calls require authentication. Use this header:
-H "Authorization: Bearer $CREWDECK_API_KEY"

Knowledge API (read-only, via curl):
- GET $CREWDECK_API_URL/api/v1/internal/knowledge/titles?project_id=$CREWDECK_PROJECT_ID — list available knowledge entries (returns id, title, category)
- GET $CREWDECK_API_URL/api/v1/internal/knowledge/get?project_id=$CREWDECK_PROJECT_ID&knowledge_id=<ID> — get full content of a knowledge entry

Knowledge API (write, via curl):
- POST $CREWDECK_API_URL/api/v1/internal/knowledge/create — create entry (body: { project_id, title, category, content })
- POST $CREWDECK_API_URL/api/v1/internal/knowledge/update — update entry (body: { project_id, knowledge_id, title?, category?, content? })
- POST $CREWDECK_API_URL/api/v1/internal/knowledge/delete — delete entry (body: { project_id, knowledge_id })`);

  parts.push(`## Instructions
Explore the codebase and create or update knowledge entries. Focus on:
- Project structure and architecture
- Key patterns and conventions
- Important modules and their responsibilities
- Build and test commands
- Configuration and environment setup

Do your best work.`);

  return parts.join("\n\n");
}
