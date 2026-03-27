import type {
  Issue,
  Comment,
  Repo,
  ProjectKnowledge,
} from "../types/entities.js";
import { escapeXml } from "../utils/xml.js";

function formatComments(comments: Comment[]): string {
  return comments
    .map((c) => {
      const time = c.created_at.replace("T", " ").slice(0, 19);
      return `[${time}] (${c.author_type}) ${c.content}`;
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
  /** Captain-specific context (project settings, running agents, queue) */
  captainContext?: CaptainContext;
}

export interface CaptainContext {
  maxConcurrency: number;
  runningAgents: Array<{ agent_id: string; issue_id: string; issue_title: string }>;
  queuedAgents: Array<{ agent_id: string; issue_id: string; issue_title: string }>;
  allIssues: Array<{ id: string; title: string; status: string; pr_status?: string }>;
}

export interface BuildScanPromptOptions {
  repo: Repo | { local_path: string; name: string } | null;
  repoPath: string;
  projectKnowledge?: ProjectKnowledge[];
}

export function buildPrompt(opts: BuildPromptOptions): string {
  const { issue, comments, repo, worktreePath, agentId, projectKnowledge, captainContext } =
    opts;
  const parts: string[] = [];

  parts.push(
    `## Issue\n<issue_title>\n${escapeXml(issue.title)}\n</issue_title>\n\n<issue_description>\n${escapeXml(issue.description ?? "")}\n</issue_description>`,
  );

  // Inject project knowledge entries (workflows and conventions only)
  const INJECT_CATEGORIES = new Set(["workflows", "conventions"]);
  if (projectKnowledge && projectKnowledge.length > 0) {
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

  // Inject captain-specific context
  if (agentId === "captain" && captainContext) {
    const ctx = captainContext;
    const lines: string[] = [
      "## Project Context",
      `Max Concurrency: ${ctx.maxConcurrency}`,
      `Running Agents: ${ctx.runningAgents.length}`,
    ];

    if (ctx.runningAgents.length > 0) {
      lines.push("\n### Running Agents");
      for (const agent of ctx.runningAgents) {
        lines.push(`- ${agent.agent_id} on ${agent.issue_id.slice(0, 8)} (${agent.issue_title})`);
      }
    }

    if (ctx.queuedAgents.length > 0) {
      lines.push("\n### Queued Agents");
      for (const agent of ctx.queuedAgents) {
        lines.push(`- ${agent.agent_id} on ${agent.issue_id.slice(0, 8)} (${agent.issue_title})`);
      }
    }

    if (ctx.allIssues.length > 0) {
      lines.push("\n### All Issues");
      for (const iss of ctx.allIssues) {
        const prStatus = iss.pr_status ? ` [PR: ${iss.pr_status}]` : "";
        lines.push(`- ${iss.id.slice(0, 8)}: ${iss.title} (${iss.status})${prStatus}`);
      }
    }

    parts.push(lines.join("\n"));
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

To trigger another agent after you're done, use \`/dispatch agent-name\` at the start of a line.
For example: "/dispatch engineer" followed by your summary of completed work.

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

  // Inject project knowledge entries (workflows and conventions only)
  const INJECT_CATEGORIES = new Set(["workflows", "conventions"]);
  if (projectKnowledge && projectKnowledge.length > 0) {
    const injected = projectKnowledge.filter((k) =>
      INJECT_CATEGORIES.has(k.category),
    );
    if (injected.length > 0) {
      const entries = injected
        .map((k) => `### ${k.title} (${k.category})\n${k.content}`)
        .join("\n\n");
      parts.push(`## Existing Knowledge\n${entries}`);
    }
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
