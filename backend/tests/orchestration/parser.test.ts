import { describe, it, expect } from "vitest";
import { parseDispatches } from "../../src/orchestration/parser.js";
import type { Agent } from "../../src/types/entities.js";

function makeAgent(id: string, name: string): Agent {
  return { id, name, title: name, description: null, system_prompt: "" };
}

const agents: Agent[] = [
  makeAgent("1", "engineer"),
  makeAgent("2", "inspector"),
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
    const result = parseDispatches("/dispatch engineer inspector docs", agents);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("engineer");
    expect(result[1].name).toBe("inspector");
    expect(result[2].name).toBe("docs");
  });

  it("extracts agents from multiple dispatch lines", () => {
    const result = parseDispatches("/dispatch engineer\n/dispatch inspector", agents);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("engineer");
    expect(result[1].name).toBe("inspector");
  });

  it("deduplicates dispatches", () => {
    const result = parseDispatches("/dispatch engineer\n/dispatch engineer", agents);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("engineer");
  });

  it("matches case-insensitively", () => {
    const result = parseDispatches("/dispatch Engineer INSPECTOR Docs", agents);
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
    const result = parseDispatches("@engineer and @inspector should review this", agents);
    expect(result).toEqual([]);
  });

  it("skips dispatch inside fenced code blocks", () => {
    const text = "Check this:\n```\n/dispatch engineer\n```\n/dispatch inspector";
    const result = parseDispatches(text, agents);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("inspector");
  });

  it("skips dispatch inside inline backticks", () => {
    const text = "Use `/dispatch engineer` for help\n/dispatch inspector";
    const result = parseDispatches(text, agents);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("inspector");
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
/dispatch engineer inspector docs
Some other text here`;
    const result = parseDispatches(content, agents);
    expect(result).toHaveLength(3);
  });

  it("ignores unknown agent names in dispatch", () => {
    const result = parseDispatches("/dispatch engineer unknown-agent inspector", agents);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("engineer");
    expect(result[1].name).toBe("inspector");
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
