import { describe, it, expect } from "vitest";
import { parseAction, validateActionParams } from "../../src/orchestrator/actions.js";

describe("parseAction", () => {
  it("parses a valid assign action", () => {
    const json = JSON.stringify({
      action: "assign",
      params: { issue_id: "issue-uuid-1", agent_id: "agent-uuid-1" },
      reasoning: "Best match",
    });
    const result = parseAction(json);
    expect(result).toEqual({
      action: "assign",
      params: { issue_id: "issue-uuid-1", agent_id: "agent-uuid-1" },
      reasoning: "Best match",
    });
  });

  it("parses JSON wrapped in a code block", () => {
    const output = "```json\n{\"action\":\"no_action\",\"params\":{},\"reasoning\":\"Nothing to do\"}\n```";
    const result = parseAction(output);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("no_action");
  });

  it("parses JSON in a plain code block", () => {
    const output = "```\n{\"action\":\"no_action\",\"params\":{},\"reasoning\":\"ok\"}\n```";
    const result = parseAction(output);
    expect(result?.action).toBe("no_action");
  });

  it("returns null for empty output", () => {
    expect(parseAction("")).toBeNull();
    expect(parseAction("   ")).toBeNull();
  });

  it("returns null for non-JSON output", () => {
    expect(parseAction("I cannot do that.")).toBeNull();
  });

  it("returns null when action field is missing", () => {
    const json = JSON.stringify({ params: {}, reasoning: "ok" });
    expect(parseAction(json)).toBeNull();
  });

  it("returns null for unknown action type", () => {
    const json = JSON.stringify({ action: "delete_all", params: {}, reasoning: "oops" });
    expect(parseAction(json)).toBeNull();
  });

  it("returns null when params is not an object", () => {
    const json = JSON.stringify({ action: "assign", params: "bad", reasoning: "ok" });
    expect(parseAction(json)).toBeNull();
  });

  it("returns null when reasoning is missing", () => {
    const json = JSON.stringify({ action: "no_action", params: {} });
    expect(parseAction(json)).toBeNull();
  });

  it("parses route_review action", () => {
    const json = JSON.stringify({
      action: "route_review",
      params: { issue_id: "i1", reviewer_agent_id: "a1", review_order: 1 },
      reasoning: "Route to Bob",
    });
    const result = parseAction(json);
    expect(result?.action).toBe("route_review");
    expect(result?.params.reviewer_agent_id).toBe("a1");
  });

  it("parses reorder action", () => {
    const json = JSON.stringify({
      action: "reorder",
      params: { issue_priorities: [{ issue_id: "i1", priority: 5 }] },
      reasoning: "Prioritize",
    });
    expect(parseAction(json)?.action).toBe("reorder");
  });
});

describe("validateActionParams", () => {
  it("returns null for valid assign action", () => {
    const action = {
      action: "assign" as const,
      params: { issue_id: "i1", agent_id: "a1" },
      reasoning: "ok",
    };
    expect(validateActionParams(action)).toBeNull();
  });

  it("returns error when assign missing issue_id", () => {
    const action = { action: "assign" as const, params: { agent_id: "a1" }, reasoning: "ok" };
    expect(validateActionParams(action)).toMatch(/issue_id/);
  });

  it("returns error when assign missing agent_id", () => {
    const action = { action: "assign" as const, params: { issue_id: "i1" }, reasoning: "ok" };
    expect(validateActionParams(action)).toMatch(/agent_id/);
  });

  it("returns null for valid route_review action", () => {
    const action = {
      action: "route_review" as const,
      params: { issue_id: "i1", reviewer_agent_id: "a1", review_order: 1 },
      reasoning: "ok",
    };
    expect(validateActionParams(action)).toBeNull();
  });

  it("returns error for route_review missing reviewer_agent_id", () => {
    const action = {
      action: "route_review" as const,
      params: { issue_id: "i1", review_order: 1 },
      reasoning: "ok",
    };
    expect(validateActionParams(action)).toMatch(/reviewer_agent_id/);
  });

  it("returns null for valid escalate action", () => {
    const action = {
      action: "escalate" as const,
      params: { issue_id: "i1", reason: "stuck" },
      reasoning: "ok",
    };
    expect(validateActionParams(action)).toBeNull();
  });

  it("returns error for escalate missing reason", () => {
    const action = { action: "escalate" as const, params: { issue_id: "i1" }, reasoning: "ok" };
    expect(validateActionParams(action)).toMatch(/reason/);
  });

  it("returns null for valid create_draft_issue", () => {
    const action = {
      action: "create_draft_issue" as const,
      params: { title: "New issue", description: "Details", priority: 5 },
      reasoning: "ok",
    };
    expect(validateActionParams(action)).toBeNull();
  });

  it("returns error for create_draft_issue missing title", () => {
    const action = {
      action: "create_draft_issue" as const,
      params: { description: "Details" },
      reasoning: "ok",
    };
    expect(validateActionParams(action)).toMatch(/title/);
  });

  it("returns null for valid reorder action", () => {
    const action = {
      action: "reorder" as const,
      params: { issue_priorities: [{ issue_id: "i1", priority: 5 }] },
      reasoning: "ok",
    };
    expect(validateActionParams(action)).toBeNull();
  });

  it("returns error for reorder with empty array", () => {
    const action = {
      action: "reorder" as const,
      params: { issue_priorities: [] },
      reasoning: "ok",
    };
    expect(validateActionParams(action)).toMatch(/non-empty/);
  });

  it("returns null for no_action", () => {
    const action = { action: "no_action" as const, params: {}, reasoning: "nothing" };
    expect(validateActionParams(action)).toBeNull();
  });
});
