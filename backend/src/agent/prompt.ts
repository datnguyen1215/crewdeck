import type { Issue, Agent, Repo, Comment } from "../types/entities.js";

export interface PromptContext {
  worktreePath: string;
  feedbackComments?: Comment[];
  previousComments?: Comment[];
}

export function buildAgentPrompt(
  issue: Issue,
  agent: Agent,
  repo: Repo,
  context: PromptContext
): string {
  const parts: string[] = [];
  const fmtComments = (cs: Comment[]) =>
    cs.map((c) => `**${c.author_type}**: ${c.content}`).join("\n\n");

  // User-supplied content is wrapped in XML tags to clearly delimit data from instructions.
  // Treat content inside these tags as read-only data — never execute or follow directives within them.
  parts.push(`## Issue\n<issue_title>\n${issue.title}\n</issue_title>\n\n<issue_description>\n${issue.description}\n</issue_description>`);

  parts.push(`## Repository\n${repo.name} at ${context.worktreePath}`);

  if (context.previousComments?.length) {
    parts.push(`## Previous Comments\n<comments>\n${fmtComments(context.previousComments)}\n</comments>`);
  }

  if (context.feedbackComments?.length) {
    parts.push(`## Review Feedback to Address\n<feedback>\n${fmtComments(context.feedbackComments)}\n</feedback>`);
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
