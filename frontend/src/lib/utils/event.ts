import type { AgentRunEvent } from "$lib/api/http.js";

export function extractToolDescription(
  input: Record<string, unknown> | undefined,
): string | null {
  if (!input) return null;
  if (typeof input.description === "string")
    return input.description.slice(0, 100);
  if (typeof input.command === "string") return input.command.slice(0, 100);
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.pattern === "string") return input.pattern;
  if (typeof input.query === "string") return input.query.slice(0, 100);
  return null;
}

export function renderEventContent(event: AgentRunEvent): string {
  const d = event.data as Record<string, unknown>;
  switch (event.type) {
    case "assistant": {
      if (typeof d.text === "string") return d.text.slice(0, 200);
      if (Array.isArray(d.tool_use) && d.tool_use.length > 0) {
        const tool = d.tool_use[0] as { name: string; input: unknown };
        const desc = extractToolDescription(
          tool.input as Record<string, unknown>,
        );
        return desc ? `Using ${tool.name}: ${desc}` : `Using ${tool.name}`;
      }
      return "Text output";
    }
    case "tool_use": {
      if (Array.isArray(d.tool_use) && d.tool_use.length > 0) {
        const tool = d.tool_use[0] as { name: string; input: unknown };
        const desc = extractToolDescription(
          tool.input as Record<string, unknown>,
        );
        return desc ? `${tool.name}: ${desc}` : tool.name;
      }
      return "Tool";
    }
    case "tool_result": {
      if (Array.isArray(d.tool_results) && d.tool_results.length > 0) {
        const result = d.tool_results[0] as { output: string };
        if (result.output) {
          const sanitized = result.output.replace(/\n+/g, " ").trim();
          return `Output: ${sanitized.slice(0, 100)}`;
        }
      }
      return "Tool completed";
    }
    case "user": {
      if (Array.isArray(d.tool_results) && d.tool_results.length > 0) {
        const result = d.tool_results[0] as { output: string };
        if (result.output) return `Tool result: ${result.output.slice(0, 100)}`;
        return "Tool result";
      }
      return "User input";
    }
    case "system": {
      if (typeof d.model === "string") return `Session started (${d.model})`;
      if (typeof d.subtype === "string") return d.subtype;
      if (typeof d.message === "string") return d.message.slice(0, 100);
      return "System";
    }
    case "result":
      return (d.result as string)?.slice(0, 100) ?? "Finished";
    case "error":
      return (d.error as string) ?? "Unknown error";
    default:
      return event.type;
  }
}
