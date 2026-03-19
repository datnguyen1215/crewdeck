import type { Issue, Comment, Repo } from "../types/entities.js";
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

export function buildPrompt(
  issue: Issue,
  comments: Comment[],
  repo: Repo | { local_path: string; default_branch: string; name: string } | null,
  worktreePath: string,
): string {
  const parts: string[] = [];

  parts.push(
    `## Issue\n<issue_title>\n${escapeXml(issue.title)}\n</issue_title>\n\n<issue_description>\n${escapeXml(issue.description ?? "")}\n</issue_description>`,
  );

  if (repo)
    parts.push(`## Repository\n${escapeXml("name" in repo ? repo.name : "repo")} at ${escapeXml(worktreePath)}`);

  if (comments.length > 0)
    parts.push(`## Comment History\n<comments>\n${formatComments(comments)}\n</comments>`);

  // Diff instructions
  const safeBranch = /^[a-zA-Z0-9._/-]+$/.test(issue.base_branch ?? "")
    ? issue.base_branch!
    : "main";

  const diffInstruction = repo
    ? `\n\nTo see what changed, run:\n  git diff $(git merge-base HEAD origin/${safeBranch}) HEAD`
    : "";

  parts.push(`## API Reference
The following environment variables are available:
- CREWDECK_API_URL — base URL of the backend API
- CREWDECK_PROJECT_ID — current project ID
- CREWDECK_AGENT_ID — your agent ID

API endpoints (use curl):
- GET $CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues — list issues
- GET $CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/{id} — get issue details
- GET $CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/{id}/comments — list comments
- GET $CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/crew/agents — list available agents`);

  parts.push(`## Instructions
Work on the issue described above. Your output will be posted as a comment on the issue.${diffInstruction}

To trigger another agent after you're done, include @agent-name in your output.
For example: "@captain I've completed the work, please review."

Do your best work. Your entire stdout will be captured and posted as a comment.`);

  return parts.join("\n\n");
}
