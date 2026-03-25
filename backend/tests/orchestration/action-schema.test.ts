import { describe, it, expect } from "vitest";
import {
  parseActionPlan,
  extractJsonFromResponse,
  actionPlanSchema,
} from "../../src/orchestration/captain/action-schema.js";

describe("action-schema", () => {
  describe("parseActionPlan", () => {
    it("parses valid action plan", () => {
      const plan = {
        reasoning: "Test reasoning",
        actions: [
          { type: "dispatch", issue_id: "abc", agent_id: "engineer" },
          { type: "merge", issue_id: "def" },
          { type: "scan" },
        ],
      };

      const result = parseActionPlan(plan);
      expect(result).toEqual(plan);
    });

    it("parses dispatch with optional instructions", () => {
      const plan = {
        actions: [
          {
            type: "dispatch",
            issue_id: "abc",
            agent_id: "lead",
            instructions: "Review the code changes",
          },
        ],
      };

      const result = parseActionPlan(plan);
      expect(result?.actions[0]).toEqual(plan.actions[0]);
    });

    it("rejects invalid agent_id", () => {
      const plan = {
        actions: [{ type: "dispatch", issue_id: "abc", agent_id: "invalid" }],
      };

      const result = parseActionPlan(plan);
      expect(result).toBeNull();
    });

    it("parses all action types", () => {
      const plan = {
        reasoning: "Full test",
        actions: [
          { type: "dispatch", issue_id: "1", agent_id: "engineer" },
          { type: "dispatch", issue_id: "2", agent_id: "lead" },
          { type: "dispatch", issue_id: "3", agent_id: "docs" },
          { type: "dispatch", issue_id: "4", agent_id: "librarian" },
          { type: "merge", issue_id: "5" },
          { type: "scan" },
          { type: "comment", issue_id: "6", content: "Test comment" },
          { type: "create-issue", title: "New issue" },
          {
            type: "create-issue",
            title: "With description",
            description: "Details",
          },
          { type: "update-issue", issue_id: "7", status: "pr_created" },
          { type: "update-issue", issue_id: "8", title: "New title" },
          { type: "skip", issue_id: "9", reason: "Blocked by dependency" },
        ],
      };

      const result = parseActionPlan(plan);
      expect(result).toEqual(plan);
      expect(result?.actions).toHaveLength(12);
    });

    it("returns null for invalid JSON", () => {
      const result = parseActionPlan("not json");
      expect(result).toBeNull();
    });

    it("returns null for missing actions array", () => {
      const result = parseActionPlan({ reasoning: "test" });
      expect(result).toBeNull();
    });
  });

  describe("extractJsonFromResponse", () => {
    it("extracts raw JSON", () => {
      const json = { reasoning: "test", actions: [] };
      const result = extractJsonFromResponse(JSON.stringify(json));
      expect(result).toEqual(json);
    });

    it("extracts JSON from markdown code block", () => {
      const json = { reasoning: "test", actions: [] };
      const text = `Here is my plan:
\`\`\`json
${JSON.stringify(json, null, 2)}
\`\`\``;
      const result = extractJsonFromResponse(text);
      expect(result).toEqual(json);
    });

    it("extracts JSON from code block without language", () => {
      const json = { actions: [] };
      const text = `\`\`\`
${JSON.stringify(json)}
\`\`\``;
      const result = extractJsonFromResponse(text);
      expect(result).toEqual(json);
    });

    it("returns null for invalid text", () => {
      const result = extractJsonFromResponse("not json at all");
      expect(result).toBeNull();
    });

    it("returns null for invalid JSON in code block", () => {
      const text = `\`\`\`json
{ invalid json }
\`\`\``;
      const result = extractJsonFromResponse(text);
      expect(result).toBeNull();
    });
  });

  describe("actionPlanSchema validation", () => {
    it("requires actions array", () => {
      const result = actionPlanSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("allows empty actions array", () => {
      const result = actionPlanSchema.safeParse({ actions: [] });
      expect(result.success).toBe(true);
    });

    it("allows optional reasoning", () => {
      const result = actionPlanSchema.safeParse({ actions: [] });
      expect(result.success).toBe(true);
      expect(result.data?.reasoning).toBeUndefined();
    });
  });
});
