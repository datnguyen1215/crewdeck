/**
 * Parse @mentions from comment content.
 *
 * Extracts agent mentions like @engineer, @captain, etc. from text content.
 */

export interface ParsedMention {
  /** The agent name mentioned (without the @ symbol) */
  agentName: string;
  /** The position in the text where the mention starts */
  position: number;
}

/**
 * Parse all @mentions from a text string.
 *
 * @param content - The text to parse for mentions
 * @param selfAgentName - Optional: skip mentions of this agent (self-mentions)
 * @returns Array of parsed mentions
 */
export function parseMentions(content: string, selfAgentName?: string): ParsedMention[] {
  const mentions: ParsedMention[] = [];
  // Match @word where word is alphanumeric, hyphen, or underscore
  const regex = /@([a-zA-Z][a-zA-Z0-9_-]*)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const agentName = match[1].toLowerCase();
    // Skip self-mentions
    if (selfAgentName && agentName === selfAgentName.toLowerCase()) {
      continue;
    }
    mentions.push({
      agentName,
      position: match.index,
    });
  }

  // Deduplicate by agent name (keep first occurrence)
  const seen = new Set<string>();
  return mentions.filter((m) => {
    if (seen.has(m.agentName)) return false;
    seen.add(m.agentName);
    return true;
  });
}

/**
 * Extract unique agent names from mentions.
 */
export function extractAgentNames(content: string, selfAgentName?: string): string[] {
  return parseMentions(content, selfAgentName).map((m) => m.agentName);
}
