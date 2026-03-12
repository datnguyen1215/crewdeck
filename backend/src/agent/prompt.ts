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

  parts.push(`## Issue\n${issue.title}\n\n${issue.description}`);

  parts.push(`## Repository\n${repo.name} at ${context.worktreePath}`);

  if (context.previousComments?.length) {
    const commentText = context.previousComments
      .map((c) => `**${c.author_type}**: ${c.content}`)
      .join("\n\n");
    parts.push(`## Previous Comments\n${commentText}`);
  }

  if (context.feedbackComments?.length) {
    const feedbackText = context.feedbackComments
      .map((c) => `**${c.author_type}**: ${c.content}`)
      .join("\n\n");
    parts.push(`## Review Feedback to Address\n${feedbackText}`);
  }

  parts.push(
    [
      "## Instructions",
      `You are ${agent.name}, a ${agent.role} agent. Work on the issue described above.`,
      "",
      "When your work is complete, run:",
      "  crewdeck signal --event work-complete",
      "",
      "Post progress updates with:",
      "  crewdeck comment --message '...'",
      "",
      "Report modified files with:",
      "  crewdeck files --modified <files>",
    ].join("\n")
  );

  return parts.join("\n\n");
}
