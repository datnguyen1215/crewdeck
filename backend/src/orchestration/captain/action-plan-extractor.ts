/**
 * Action plan extraction from Claude stream events or result text.
 */
import { parseActionPlan, extractJsonFromResponse } from "./action-schema.js";
import type { ActionPlan } from "./action-schema.js";

/**
 * Extract action plan from Claude stream events.
 * Looks for the final result message and parses JSON from it.
 */
export function extractActionPlanFromEvents(
  events: Array<{ type: string; [key: string]: unknown }>,
): ActionPlan | null {
  const resultEvent = events.find((e) => e.type === "result");
  if (!resultEvent) return null;

  const resultText =
    typeof resultEvent.result === "string" ? resultEvent.result : null;
  if (!resultText) return null;

  const json = extractJsonFromResponse(resultText);
  if (!json) return null;

  return parseActionPlan(json);
}

/**
 * Extract action plan from a result text string.
 */
export function extractActionPlanFromText(text: string): ActionPlan | null {
  const json = extractJsonFromResponse(text);
  if (!json) return null;
  return parseActionPlan(json);
}
