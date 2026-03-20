import { describe, it, expect } from "vitest";
import { parseMentions } from "../../src/mention/parser.js";
import type { Agent } from "../../src/types/entities.js";

function makeAgent(id: string, name: string): Agent {
  return { id, name, title: name, description: null, system_prompt: "" };
}

const agents: Agent[] = [
  makeAgent("1", "engineer"),
  makeAgent("2", "security"),
  makeAgent("3", "architect"),
  makeAgent("4", "quality"),
  makeAgent("5", "captain"),
  makeAgent("6", "code-reviewer"),
  makeAgent("7", "qa_lead"),
];

describe("parseMentions", () => {
  it("extracts single mention", () => {
    const result = parseMentions("Hello @engineer please help", agents);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("engineer");
  });

  it("extracts multiple mentions on separate lines", () => {
    const result = parseMentions("@engineer please\n@security please review", agents);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("engineer");
    expect(result[1].name).toBe("security");
  });

  it("deduplicates mentions", () => {
    const result = parseMentions("@engineer do this\n@engineer do that", agents);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("engineer");
  });

  it("matches case-insensitively", () => {
    const result = parseMentions("@Engineer help\n@SECURITY check\n@Architect review", agents);
    expect(result).toHaveLength(3);
  });

  it("skips self-mentions", () => {
    const result = parseMentions("I am @captain\n@engineer please help", agents, "5");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("engineer");
  });

  it("returns empty array for no mentions", () => {
    const result = parseMentions("Just a normal comment", agents);
    expect(result).toEqual([]);
  });

  it("skips mentions inside fenced code blocks", () => {
    const text = "Check this:\n```\n@engineer code here\n```\n@security please review";
    const result = parseMentions(text, agents);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("security");
  });

  it("skips mentions inside inline backticks", () => {
    const text = "Use `@engineer` for help\n@security please review";
    const result = parseMentions(text, agents);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("security");
  });

  it("handles mentions at start and end of lines", () => {
    const result = parseMentions("@engineer please help\n@quality check", agents);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("engineer");
    expect(result[1].name).toBe("quality");
  });

  it("handles multiline content", () => {
    const content = `Please review:
@engineer for implementation
@security for vulnerabilities
@quality for test coverage`;
    const result = parseMentions(content, agents);
    expect(result).toHaveLength(3);
  });

  it("one mention per line", () => {
    const result = parseMentions("@engineer and @security on same line", agents);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("engineer");
  });
});
