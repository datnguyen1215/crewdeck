import { describe, it, expect } from "vitest";
import { parseDispatches, parseCommands } from "../../src/orchestration/parser.js";
import type { Agent } from "../../src/types/entities.js";

function makeAgent(id: string, name: string): Agent {
  return { id, name, title: name, description: null, system_prompt: "" };
}

const agents: Agent[] = [
  makeAgent("1", "engineer"),
  makeAgent("2", "lead"),
  makeAgent("3", "docs"),
  makeAgent("4", "captain"),
  makeAgent("5", "code-reviewer"),
  makeAgent("6", "qa_lead"),
];

describe("parseDispatches", () => {
  it("extracts single dispatch", () => {
    const result = parseDispatches("/dispatch engineer", agents);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("engineer");
  });

  it("extracts multiple agents from single dispatch", () => {
    const result = parseDispatches("/dispatch engineer lead docs", agents);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("engineer");
    expect(result[1].name).toBe("lead");
    expect(result[2].name).toBe("docs");
  });

  it("extracts agents from multiple dispatch lines", () => {
    const result = parseDispatches("/dispatch engineer\n/dispatch lead", agents);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("engineer");
    expect(result[1].name).toBe("lead");
  });

  it("deduplicates dispatches", () => {
    const result = parseDispatches("/dispatch engineer\n/dispatch engineer", agents);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("engineer");
  });

  it("matches case-insensitively", () => {
    const result = parseDispatches("/dispatch Engineer LEAD Docs", agents);
    expect(result).toHaveLength(3);
  });

  it("skips self-dispatch", () => {
    const result = parseDispatches("/dispatch captain engineer", agents, "4");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("engineer");
  });

  it("returns empty array for no dispatch", () => {
    const result = parseDispatches("Just a normal comment", agents);
    expect(result).toEqual([]);
  });

  it("ignores @mentions (no spawning)", () => {
    const result = parseDispatches("Hello @engineer please help", agents);
    expect(result).toEqual([]);
  });

  it("ignores @mentions mixed with text", () => {
    const result = parseDispatches("@engineer and @lead should review this", agents);
    expect(result).toEqual([]);
  });

  it("skips dispatch inside fenced code blocks", () => {
    const text = "Check this:\n```\n/dispatch engineer\n```\n/dispatch lead";
    const result = parseDispatches(text, agents);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("lead");
  });

  it("skips dispatch inside inline backticks", () => {
    const text = "Use `/dispatch engineer` for help\n/dispatch lead";
    const result = parseDispatches(text, agents);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("lead");
  });

  it("handles dispatch at start of line with leading whitespace", () => {
    const result = parseDispatches("  /dispatch engineer", agents);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("engineer");
  });

  it("ignores dispatch in middle of line", () => {
    const result = parseDispatches("Please /dispatch engineer", agents);
    expect(result).toEqual([]);
  });

  it("handles multiline content with dispatch", () => {
    const content = `Please review:
/dispatch engineer lead docs
Some other text here`;
    const result = parseDispatches(content, agents);
    expect(result).toHaveLength(3);
  });

  it("ignores unknown agent names in dispatch", () => {
    const result = parseDispatches("/dispatch engineer unknown-agent lead", agents);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("engineer");
    expect(result[1].name).toBe("lead");
  });

  it("handles dispatch followed by text content", () => {
    const content = `/dispatch engineer

Please implement the feature described above.
Focus on:
- Adding the new route
- Writing tests`;
    const result = parseDispatches(content, agents);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("engineer");
  });
});

describe("parseCommands", () => {
  it("extracts merge command with full UUID", () => {
    const result = parseCommands("/merge a3f21b78-1234-5678-9abc-def012345678");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "merge",
      issueId: "a3f21b78-1234-5678-9abc-def012345678",
    });
  });

  it("extracts merge command with truncated UUID", () => {
    const result = parseCommands("/merge a3f21b78");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "merge",
      issueId: "a3f21b78",
    });
  });

  it("extracts create-pr command", () => {
    const result = parseCommands("/create-pr fa41fc96");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "create-pr",
      issueId: "fa41fc96",
    });
  });

  it("extracts create-issue command with title", () => {
    const result = parseCommands('/create-issue Fix bug in auth');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "create-issue",
      title: "Fix bug in auth",
    });
  });

  it("extracts create-issue command with multiline title", () => {
    const result = parseCommands('/create-issue Add dark mode support');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "create-issue",
      title: "Add dark mode support",
    });
  });

  it("extracts multiple commands", () => {
    const result = parseCommands(
      "/merge a3f21b78\n/create-pr fa41fc96\n/create-issue Test issue"
    );
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe("merge");
    expect(result[1].type).toBe("create-pr");
    expect(result[2].type).toBe("create-issue");
  });

  it("skips commands inside fenced code blocks", () => {
    const text = "Check this:\n```\n/merge a3f21b78\n```\n/create-pr fa41fc96";
    const result = parseCommands(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("create-pr");
  });

  it("skips commands inside inline backticks", () => {
    const text = "Use `/merge issue-id` to merge\n/create-pr fa41fc96";
    const result = parseCommands(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("create-pr");
  });

  it("returns empty array for no commands", () => {
    const result = parseCommands("Just a normal comment");
    expect(result).toEqual([]);
  });

  it("handles malformed create-issue (missing title)", () => {
    const result = parseCommands('/create-issue');
    expect(result).toEqual([]);
  });

  it("handles malformed merge (no issue ID)", () => {
    const result = parseCommands("/merge");
    expect(result).toEqual([]);
  });

  it("handles malformed create-pr (no issue ID)", () => {
    const result = parseCommands("/create-pr");
    expect(result).toEqual([]);
  });

  it("handles commands at start of line with leading whitespace", () => {
    const result = parseCommands("  /merge a3f21b78");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("merge");
  });

  it("ignores commands in middle of line", () => {
    const result = parseCommands("Please /merge a3f21b78");
    expect(result).toEqual([]);
  });
});
