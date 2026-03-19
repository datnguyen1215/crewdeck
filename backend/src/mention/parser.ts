import type { Agent } from "../types/entities.js";

/**
 * Parse @mentions from a comment. Returns matched agents.
 * Rules:
 * - One mention per line
 * - Longest agent name matched first (greedy)
 * - Case-insensitive matching
 * - Skips mentions inside fenced code blocks or inline backticks
 * - Skips self-mentions
 */
export function parseMentions(
  text: string,
  agents: Agent[],
  selfAgentId?: string,
): Agent[] {
  // Remove fenced code blocks
  const withoutFenced = text.replace(/```[\s\S]*?```/g, "");
  // Remove inline backticks
  const withoutCode = withoutFenced.replace(/`[^`]+`/g, "");

  // Sort agents by name length descending for greedy matching
  const sorted = [...agents].sort((a, b) => b.name.length - a.name.length);

  const matched: Agent[] = [];
  const seenIds = new Set<string>();

  for (const line of withoutCode.split("\n")) {
    // Find @mention in this line
    const atIdx = line.indexOf("@");
    if (atIdx === -1) continue;

    const afterAt = line.slice(atIdx + 1);
    for (const agent of sorted) {
      if (afterAt.toLowerCase().startsWith(agent.name.toLowerCase())) {
        if (agent.id === selfAgentId) break; // skip self
        if (!seenIds.has(agent.id)) {
          seenIds.add(agent.id);
          matched.push(agent);
        }
        break; // one mention per line
      }
    }
  }

  return matched;
}
