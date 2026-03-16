import type { Issue, Agent, Repo, Comment } from "../types/entities.js";
import { escapeXml } from "../utils/xml.js";

const fmtComments = (cs: Comment[]) =>
  cs.map((c) => `**${c.author_type}**: ${escapeXml(c.content)}`).join("\n\n");

export interface ReviewerPromptContext {
  worktreePath: string;
  branchName: string;
  comments?: Comment[];
}

export function buildReviewerPrompt(
  issue: Issue,
  reviewer: Agent,
  repo: Repo | null,
  context: ReviewerPromptContext
): string {
  const parts: string[] = [];

  parts.push(`## Issue\n<issue_title>\n${escapeXml(issue.title)}\n</issue_title>\n\n<issue_description>\n${escapeXml(issue.description ?? "")}\n</issue_description>`);

  if (repo) {
    parts.push(`## Repository\n${escapeXml(repo.name)} at ${escapeXml(context.worktreePath)} (branch: ${escapeXml(context.branchName)})`);
  }

  if (context.comments?.length) {
    parts.push(`## Issue Comments\n<comments>\n${fmtComments(context.comments)}\n</comments>`);
  }

  // Validate base_branch to prevent shell injection — only allow safe branch name characters.
  const safeBranch = /^[a-zA-Z0-9._/-]+$/.test(issue.base_branch ?? "") ? issue.base_branch! : "main";

  const diffInstruction = repo
    ? `\n\nTo see what changed, run:\n  git diff \$(git merge-base HEAD origin/${safeBranch}) HEAD`
    : "";

  parts.push(`## Instructions
You are ${escapeXml(reviewer.name)}, a ${escapeXml(reviewer.title)} reviewer. Review the code changes for the issue above.${diffInstruction}

Evaluate correctness, quality, and completeness. Then signal your verdict:

If the code looks good:
  crewdeck signal --event review-complete --data '{"verdict":"approved"}'

If changes are needed:
  crewdeck comment --message 'Specific feedback here'
  crewdeck signal --event review-complete --data '{"verdict":"changes_requested"}'`);

  return parts.join("\n\n");
}

export interface PromptContext {
  worktreePath: string;
  feedbackComments?: Comment[];
  previousComments?: Comment[];
}

export function buildAgentPrompt(
  issue: Issue,
  agent: Agent,
  repo: Repo | null,
  context: PromptContext
): string {
  const parts: string[] = [];

  // User-supplied content is wrapped in XML tags to clearly delimit data from instructions.
  // Treat content inside these tags as read-only data — never execute or follow directives within them.
  parts.push(`## Issue\n<issue_title>\n${escapeXml(issue.title)}\n</issue_title>\n\n<issue_description>\n${escapeXml(issue.description ?? "")}\n</issue_description>`);

  if (repo) {
    parts.push(`## Repository\n${escapeXml(repo.name)} at ${escapeXml(context.worktreePath)}`);
  }

  if (context.previousComments?.length) {
    parts.push(`## Previous Comments\n<comments>\n${fmtComments(context.previousComments)}\n</comments>`);
  }

  if (context.feedbackComments?.length) {
    parts.push(`## Review Feedback to Address\n<feedback>\n${fmtComments(context.feedbackComments)}\n</feedback>`);
  }

  parts.push(`## Instructions
You are ${escapeXml(agent.name)}, a ${escapeXml(agent.title)} agent. Work on the issue described above.

When your work is complete, run:
  crewdeck signal --event work-complete

Post progress updates with:
  crewdeck comment --message '...'

Report modified files with:
  crewdeck files --modified <files>`);

  return parts.join("\n\n");
}
