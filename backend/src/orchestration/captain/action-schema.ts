/**
 * Action Schema
 *
 * Zod schemas for structured action plans from the Monitor LLM.
 */
import { z } from "zod";
import { logger } from "../../logger.js";

export const dispatchActionSchema = z.object({
  type: z.literal("dispatch"),
  issue_id: z.string(),
  agent_id: z.enum(["engineer", "inspector", "docs", "librarian", "supervisor"]),
  instructions: z.string().optional(),
});

export const mergeActionSchema = z.object({
  type: z.literal("merge"),
  issue_id: z.string(),
});

export const scanActionSchema = z.object({
  type: z.literal("scan"),
});

export const commentActionSchema = z.object({
  type: z.literal("comment"),
  issue_id: z.string(),
  content: z.string(),
});

export const createIssueActionSchema = z.object({
  type: z.literal("create-issue"),
  title: z.string(),
  description: z.string().optional(),
});

export const updateIssueActionSchema = z.object({
  type: z.literal("update-issue"),
  issue_id: z.string(),
  status: z.string().optional(),
  title: z.string().optional(),
});

export const createPRActionSchema = z.object({
  type: z.literal("create-pr"),
  issue_id: z.string(),
  body: z.string().optional(),
});

export const skipActionSchema = z.object({
  type: z.literal("skip"),
  issue_id: z.string(),
  reason: z.string(),
});

export const setDependenciesActionSchema = z.object({
  type: z.literal("set-dependencies"),
  issue_id: z.string(),
  depends_on: z.array(z.string()),
});

export const spawnSupervisorActionSchema = z.object({
  type: z.literal("spawn-supervisor"),
  issue_id: z.string(),
});

export const actionSchema = z.discriminatedUnion("type", [
  dispatchActionSchema,
  mergeActionSchema,
  scanActionSchema,
  commentActionSchema,
  createIssueActionSchema,
  updateIssueActionSchema,
  createPRActionSchema,
  skipActionSchema,
  setDependenciesActionSchema,
  spawnSupervisorActionSchema,
]);

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
export type CreatePRAction = z.infer<typeof createPRActionSchema>;
export type SkipAction = z.infer<typeof skipActionSchema>;
export type SetDependenciesAction = z.infer<typeof setDependenciesActionSchema>;
export type SpawnSupervisorAction = z.infer<typeof spawnSupervisorActionSchema>;
export type Action = z.infer<typeof actionSchema>;
export type ActionPlan = z.infer<typeof actionPlanSchema>;

export function parseActionPlan(json: unknown): ActionPlan | null {
  const result = actionPlanSchema.safeParse(json);
  return result.success ? result.data : null;
}

export function extractJsonFromResponse(text: string): unknown | null {
  const trimmed = text.trim();

  const actionMatch = trimmed.match(/<action>([\s\S]*?)<\/action>/);
  if (actionMatch) {
    try {
      return JSON.parse(actionMatch[1].trim());
    } catch {
      // Invalid JSON inside tags
      logger.debug("Failed to parse JSON inside <action> tags");
    }
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Not raw JSON
    logger.debug("Response is not raw JSON");
  }

  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  const blocks: string[] = [];
  let match;
  while ((match = codeBlockRegex.exec(trimmed)) !== null) {
    blocks.push(match[1].trim());
  }

  for (const block of blocks) {
    if (block.includes('"actions"')) {
      try {
        return JSON.parse(block);
      } catch {
        // Invalid JSON
        logger.debug("Failed to parse JSON from actions code block");
      }
    }
  }

  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(blocks[i]);
    } catch {
      // Invalid JSON
      logger.debug("Failed to parse JSON from code block");
    }
  }

  return null;
}
