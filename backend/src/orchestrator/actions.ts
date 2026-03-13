export type ActionType =
  | "assign"
  | "route_review"
  | "escalate"
  | "create_draft_issue"
  | "reorder"
  | "no_action";

export interface OrchestratorAction {
  action: ActionType;
  params: Record<string, unknown>;
  reasoning: string;
}

const VALID_ACTIONS = new Set<ActionType>([
  "assign",
  "route_review",
  "escalate",
  "create_draft_issue",
  "reorder",
  "no_action",
]);

// Extract JSON from Claude output — handles raw JSON or ```json ... ``` code blocks
function extractJson(output: string): string {
  const trimmed = output.trim();

  // Try code block first
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (codeBlock) return codeBlock[1].trim();

  // Otherwise assume raw JSON
  return trimmed;
}

export function parseAction(output: string): OrchestratorAction | null {
  if (!output || !output.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(output));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.action !== "string") return null;
  if (!VALID_ACTIONS.has(obj.action as ActionType)) return null;
  if (typeof obj.params !== "object" || obj.params === null || Array.isArray(obj.params)) return null;
  if (typeof obj.reasoning !== "string") return null;

  return {
    action: obj.action as ActionType,
    params: obj.params as Record<string, unknown>,
    reasoning: obj.reasoning,
  };
}

// Validate action-specific params; returns an error string or null if valid
export function validateActionParams(action: OrchestratorAction): string | null {
  const { params } = action;

  switch (action.action) {
    case "assign":
      if (typeof params.issue_id !== "string" || !params.issue_id) return "assign: missing issue_id";
      if (typeof params.agent_id !== "string" || !params.agent_id) return "assign: missing agent_id";
      return null;

    case "route_review":
      if (typeof params.issue_id !== "string" || !params.issue_id) return "route_review: missing issue_id";
      if (typeof params.reviewer_agent_id !== "string" || !params.reviewer_agent_id)
        return "route_review: missing reviewer_agent_id";
      if (typeof params.review_order !== "number") return "route_review: missing review_order";
      return null;

    case "escalate":
      if (typeof params.issue_id !== "string" || !params.issue_id) return "escalate: missing issue_id";
      if (typeof params.reason !== "string" || !params.reason) return "escalate: missing reason";
      return null;

    case "create_draft_issue":
      if (typeof params.title !== "string" || !params.title) return "create_draft_issue: missing title";
      if (typeof params.description !== "string") return "create_draft_issue: missing description";
      return null;

    case "reorder": {
      const priorities = params.issue_priorities;
      if (!Array.isArray(priorities) || priorities.length === 0)
        return "reorder: issue_priorities must be a non-empty array";
      for (const entry of priorities) {
        if (
          typeof entry !== "object" ||
          entry === null ||
          typeof (entry as Record<string, unknown>).issue_id !== "string" ||
          typeof (entry as Record<string, unknown>).priority !== "number"
        )
          return "reorder: each entry must have issue_id (string) and priority (number)";
      }
      return null;
    }

    case "no_action":
      return null;
  }
}
