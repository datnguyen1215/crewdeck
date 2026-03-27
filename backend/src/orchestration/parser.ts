import type { Agent } from "../types/entities.js";

/**
 * Parse /dispatch commands from a comment. Returns matched agents.
 * Rules:
 * - `/dispatch agent1 agent2 ...` syntax (space-separated)
 * - Only `/dispatch` at the start of a line triggers spawning
 * - @mentions are ignored (cosmetic references only)
 * - Case-insensitive matching
 * - Skips dispatches inside fenced code blocks or inline backticks
 * - Skips self-dispatches
 */
export function parseDispatches(
  text: string,
  agents: Agent[],
  selfAgentId?: string,
): Agent[] {
  // Remove fenced code blocks
  const withoutFenced = text.replace(/```[\s\S]*?```/g, "");
  // Remove inline backticks
  const withoutCode = withoutFenced.replace(/`[^`]+`/g, "");

  const sorted = [...agents];

  const matched: Agent[] = [];
  const seenIds = new Set<string>();

  for (const line of withoutCode.split("\n")) {
    // Look for /dispatch at start of line (ignoring leading whitespace)
    const trimmedLine = line.trimStart();
    if (!trimmedLine.toLowerCase().startsWith("/dispatch ")) continue;

    // Extract agent names after /dispatch
    const afterDispatch = trimmedLine.slice("/dispatch ".length).trim();
    const tokens = afterDispatch.split(/\s+/).filter((t) => t.length > 0);

    for (const token of tokens) {
      // Match token against agent names (case-insensitive)
      for (const agent of sorted) {
        if (token.toLowerCase() === agent.name.toLowerCase()) {
          if (agent.id === selfAgentId) break; // skip self
          if (agent.dispatchable === false) break; // skip non-dispatchable agents (background services)
          if (!seenIds.has(agent.id)) {
            seenIds.add(agent.id);
            matched.push(agent);
          }
          break;
        }
      }
    }
  }

  return matched;
}

export interface MergeCommand {
  type: "merge";
  issueId: string;
}

export interface CreateIssueCommand {
  type: "create-issue";
  title: string;
  description?: string;
}

export interface CreatePRCommand {
  type: "create-pr";
  issueId: string;
}

export type Command = MergeCommand | CreateIssueCommand | CreatePRCommand;

/**
 * Parse captain-specific commands from a comment.
 * Commands:
 * - /merge <issue_id> - Merge a PR for an issue
 * - /create-issue <title> - Create a new issue
 * - /create-pr <issue_id> - Create a PR for an issue
 *
 * Only captain can execute these commands.
 */
export function parseCommands(text: string): Command[] {
  // Remove fenced code blocks
  const withoutFenced = text.replace(/```[\s\S]*?```/g, "");
  // Remove inline backticks
  const withoutCode = withoutFenced.replace(/`[^`]+`/g, "");

  const commands: Command[] = [];

  for (const line of withoutCode.split("\n")) {
    const trimmedLine = line.trimStart();

    // Parse /merge <issue_id>
    const mergeMatch = trimmedLine.match(/^\/merge\s+(\S+)/i);
    if (mergeMatch) {
      commands.push({ type: "merge", issueId: mergeMatch[1] });
      continue;
    }

    // Parse /create-pr <issue_id>
    const createPRMatch = trimmedLine.match(/^\/create-pr\s+(\S+)/i);
    if (createPRMatch) {
      commands.push({ type: "create-pr", issueId: createPRMatch[1] });
      continue;
    }

    // Parse /create-issue <title>
    const createIssueMatch = trimmedLine.match(/^\/create-issue\s+(.+)$/i);
    if (createIssueMatch) {
      const title = createIssueMatch[1].trim();
      commands.push({ type: "create-issue", title });
      continue;
    }
  }

  return commands;
}
