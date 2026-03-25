/**
 * Action Schema
 *
 * Zod schemas for structured action plans from the Monitor LLM.
 * Replaces curl-based tool execution with deterministic backend execution.
 */
import { z } from "zod";

/** Dispatch an agent to work on an issue */
export const dispatchActionSchema = z.object({
  type: z.literal("dispatch"),
  issue_id: z.string(),
  agent_id: z.enum(["engineer", "lead", "docs", "librarian"]),
  instructions: z.string().optional(),
});

/** Merge a PR for an issue */
export const mergeActionSchema = z.object({
  type: z.literal("merge"),
  issue_id: z.string(),
});

/** Trigger a librarian codebase scan */
export const scanActionSchema = z.object({
  type: z.literal("scan"),
});

/** Add a comment to an issue */
export const commentActionSchema = z.object({
  type: z.literal("comment"),
  issue_id: z.string(),
  content: z.string(),
});

/** Create a new issue */
export const createIssueActionSchema = z.object({
  type: z.literal("create-issue"),
  title: z.string(),
  description: z.string().optional(),
});

/** Update an existing issue */
export const updateIssueActionSchema = z.object({
  type: z.literal("update-issue"),
  issue_id: z.string(),
  status: z.string().optional(),
  title: z.string().optional(),
});

/** Skip an issue (logged for observability) */
export const skipActionSchema = z.object({
  type: z.literal("skip"),
  issue_id: z.string(),
  reason: z.string(),
});

/** Union of all action types */
export const actionSchema = z.discriminatedUnion("type", [
  dispatchActionSchema,
  mergeActionSchema,
  scanActionSchema,
  commentActionSchema,
  createIssueActionSchema,
  updateIssueActionSchema,
  skipActionSchema,
]);

/** Full action plan from the Monitor LLM */
export const actionPlanSchema = z.object({
  reasoning: z.string().optional(),
  actions: z.array(actionSchema),
});

export type DispatchAction = z.infer<typeof dispatchActionSchema>;
export type MergeAction = z.infer<typeof mergeActionSchema>;
export type ScanAction = z.infer<typeof scanActionSchema>;
export type CommentAction = z.infer<typeof commentActionSchema>;
export type CreateIssueAction = z.infer<typeof createIssueActionSchema>;
export type UpdateIssueAction = z.infer<typeof updateIssueActionSchema>;
export type SkipAction = z.infer<typeof skipActionSchema>;
export type Action = z.infer<typeof actionSchema>;
export type ActionPlan = z.infer<typeof actionPlanSchema>;

/**
 * Parse and validate an action plan from LLM output.
 * Returns null if parsing fails.
 */
export function parseActionPlan(json: unknown): ActionPlan | null {
  const result = actionPlanSchema.safeParse(json);
  return result.success ? result.data : null;
}

/**
 * Extract JSON from LLM response that may contain markdown code blocks.
 * Handles both raw JSON and ```json ... ``` wrapped content.
 */
export function extractJsonFromResponse(text: string): unknown | null {
  const trimmed = text.trim();

  // Try parsing as raw JSON first
  try {
    return JSON.parse(trimmed);
  } catch {
    // Not raw JSON, continue
  }

  // Try extracting from markdown code block
  const jsonBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim());
    } catch {
      // Invalid JSON in code block
    }
  }

  return null;
}
