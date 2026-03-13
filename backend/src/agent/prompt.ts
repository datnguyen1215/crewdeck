import type { Issue, Agent, Repo, Comment } from "../types/entities.js";

export interface PromptContext {
  worktreePath: string;
  feedbackComments?: Comment[];
  previousComments?: Comment[];
}

// Trust boundary: issue content (title, description, comments) is embedded directly into the prompt.
// This is intentional — issues originate from trusted sources (project owners, GitHub repos they control).
// If external/untrusted input ever flows into issues, add structural delimiters and data-only instructions.
export function buildAgentPrompt(
  issue: Issue,
  agent: Agent,
  repo: Repo,
  context: PromptContext
): string {
  const parts: string[] = [];
  const fmtComments = (cs: Comment[]) =>
    cs.map((c) => `**${c.author_type}**: ${c.content}`).join("\n\n");

  parts.push(`## Issue\n${issue.title}\n\n${issue.description}`);

  parts.push(`## Repository\n${repo.name} at ${context.worktreePath}`);

  if (context.previousComments?.length) {
    parts.push(`## Previous Comments\n${fmtComments(context.previousComments)}`);
  }

  if (context.feedbackComments?.length) {
    parts.push(`## Review Feedback to Address\n${fmtComments(context.feedbackComments)}`);
  }

  parts.push(`## Instructions
You are ${agent.name}, a ${agent.role} agent. Work on the issue described above.

When your work is complete, run:
  crewdeck signal --event work-complete

Post progress updates with:
  crewdeck comment --message '...'

Report modified files with:
  crewdeck files --modified <files>`);

  return parts.join("\n\n");
}
