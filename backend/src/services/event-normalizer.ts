import type { AgentRunEvent } from "../types/entities.js";

/**
 * Normalized event structure for frontend consumption.
 * Flattens Claude CLI's nested message.content[] structure.
 */
export interface NormalizedEventData {
  text?: string;
  thinking?: string;
  tool_use?: { id: string; name: string; input: unknown }[];
  tool_results?: { tool_use_id: string; output: string; is_error?: boolean }[];
  model?: string;
  subtype?: string;
  result?: string;
  message?: string;
  error?: string;
  cost_usd?: number;
  duration_ms?: number;
}

/**
 * Normalizes a raw Claude CLI event into a flat structure.
 * Extracts text, tool_use, tool_result from nested message.content[].
 */
export function normalizeEvent(event: AgentRunEvent): AgentRunEvent {
  // Guard: if data is missing or not an object, return event unchanged
  if (!event.data || typeof event.data !== "object") {
    return event;
  }

  const raw = event.data as Record<string, unknown>;
  const normalized: NormalizedEventData = {};

  switch (event.type) {
    case "assistant": {
      const message = raw.message as Record<string, unknown> | undefined;
      const contentArr = message?.content ?? raw.content;
      if (Array.isArray(contentArr)) {
        // Extract text blocks
        const textBlocks = contentArr
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .filter(Boolean);
        if (textBlocks.length > 0) {
          normalized.text = textBlocks.join("\n");
        }

        // Extract thinking blocks
        const thinkingBlocks = contentArr
          .filter((c: any) => c.type === "thinking")
          .map((c: any) => c.thinking)
          .filter(Boolean);
        if (thinkingBlocks.length > 0) {
          normalized.thinking = thinkingBlocks.join("\n");
        }

        // Extract tool_use blocks
        const toolUseBlocks = contentArr
          .filter((c: any) => c.type === "tool_use")
          .map((c: any) => ({
            id: c.id,
            name: c.name,
            input: c.input,
          }));
        if (toolUseBlocks.length > 0) {
          normalized.tool_use = toolUseBlocks;
        }
      }
      // If nothing extracted, return original event unchanged
      if (Object.keys(normalized).length === 0) {
        return event;
      }
      break;
    }

    case "user": {
      const message = raw.message as Record<string, unknown> | undefined;
      const contentArr = message?.content ?? raw.content;
      if (Array.isArray(contentArr)) {
        // Extract tool_result blocks
        const toolResults = contentArr
          .filter((c: any) => c.type === "tool_result")
          .map((c: any) => {
            let output = "";
            if (typeof c.content === "string") {
              output = c.content;
            } else if (Array.isArray(c.content)) {
              const textPart = c.content.find((p: any) => p.type === "text");
              output = textPart?.text ?? "";
            }
            return {
              tool_use_id: c.tool_use_id ?? "",
              output,
              is_error: c.is_error,
            };
          });
        if (toolResults.length > 0) {
          normalized.tool_results = toolResults;
        }

        // Also extract text blocks from user events (e.g. user messages)
        const textBlocks = contentArr
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .filter(Boolean);
        if (textBlocks.length > 0) {
          normalized.text = textBlocks.join("\n");
        }
      }
      // If nothing extracted, return original event unchanged
      if (Object.keys(normalized).length === 0) {
        return event;
      }
      break;
    }

    case "system": {
      // Pass through relevant fields
      if (typeof raw.model === "string") normalized.model = raw.model;
      if (typeof raw.subtype === "string") normalized.subtype = raw.subtype;
      if (typeof raw.message === "string") normalized.message = raw.message;
      break;
    }

    case "result": {
      if (typeof raw.result === "string") normalized.result = raw.result;
      if (typeof raw.cost_usd === "number") normalized.cost_usd = raw.cost_usd;
      if (typeof raw.total_cost_usd === "number")
        normalized.cost_usd = raw.total_cost_usd as number;
      if (typeof raw.duration_ms === "number")
        normalized.duration_ms = raw.duration_ms;
      break;
    }

    case "error": {
      normalized.error =
        typeof raw.error === "string"
          ? raw.error
          : typeof raw.message === "string"
            ? raw.message
            : "Unknown error";
      break;
    }

    case "tool_use": {
      // Already flat format from some paths - normalize
      const name = (raw.name ?? raw.tool_name ?? "") as string;
      const input = raw.input;
      if (name) {
        normalized.tool_use = [{ id: (raw.id ?? "") as string, name, input }];
      }
      break;
    }

    case "tool_result": {
      // Already flat format from some paths - normalize
      let output = "";
      if (typeof raw.output === "string") output = raw.output;
      else if (typeof raw.content === "string") output = raw.content;
      else if (typeof raw.result === "string") output = raw.result;
      normalized.tool_results = [
        {
          tool_use_id: (raw.tool_use_id ?? "") as string,
          output,
          is_error: raw.is_error as boolean | undefined,
        },
      ];
      break;
    }

    default:
      // Pass through unknown types as-is
      return event;
  }

  return {
    ...event,
    data: normalized,
  };
}
