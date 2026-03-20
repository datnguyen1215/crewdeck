import { describe, it, expect } from "vitest";
import { parseMentions, extractAgentNames } from "../../src/mention/parser.js";

describe("parseMentions", () => {
  it("extracts single mention", () => {
    const result = parseMentions("Hello @engineer please help");
    expect(result).toEqual([{ agentName: "engineer", position: 6 }]);
  });

  it("extracts multiple mentions", () => {
    const result = parseMentions("@engineer and @security please review");
    expect(result).toHaveLength(2);
    expect(result[0].agentName).toBe("engineer");
    expect(result[1].agentName).toBe("security");
  });

  it("deduplicates mentions (keeps first)", () => {
    const result = parseMentions("@engineer do this @engineer do that");
    expect(result).toHaveLength(1);
    expect(result[0].agentName).toBe("engineer");
    expect(result[0].position).toBe(0);
  });

  it("normalizes to lowercase", () => {
    const result = parseMentions("@Engineer @SECURITY @Architect");
    expect(result.map((m) => m.agentName)).toEqual(["engineer", "security", "architect"]);
  });

  it("skips self-mentions", () => {
    const result = parseMentions("I am @captain and I mention @engineer", "captain");
    expect(result).toHaveLength(1);
    expect(result[0].agentName).toBe("engineer");
  });

  it("handles self-mention case insensitively", () => {
    const result = parseMentions("@Captain says hello to @engineer", "captain");
    expect(result).toHaveLength(1);
    expect(result[0].agentName).toBe("engineer");
  });

  it("returns empty array for no mentions", () => {
    const result = parseMentions("Just a normal comment");
    expect(result).toEqual([]);
  });

  it("handles mentions with hyphens and underscores", () => {
    const result = parseMentions("@code-reviewer and @qa_lead please check");
    expect(result).toHaveLength(2);
    expect(result[0].agentName).toBe("code-reviewer");
    expect(result[1].agentName).toBe("qa_lead");
  });

  it("extracts mentions even from email-like patterns", () => {
    // The regex matches @example from emails and @engineer as a standalone mention.
    // This is acceptable since non-existent agents are filtered out during resolution.
    const result = parseMentions("Contact user@example.com for help @engineer");
    expect(result.some((m) => m.agentName === "engineer")).toBe(true);
    expect(result.some((m) => m.agentName === "example")).toBe(true);
  });

  it("handles mentions at start and end", () => {
    const result = parseMentions("@engineer please help @quality");
    expect(result).toHaveLength(2);
    expect(result[0].agentName).toBe("engineer");
    expect(result[1].agentName).toBe("quality");
  });

  it("handles multiline content", () => {
    const content = `Please review:
@engineer for implementation
@security for vulnerabilities
@quality for test coverage`;
    const result = parseMentions(content);
    expect(result).toHaveLength(3);
  });
});

describe("extractAgentNames", () => {
  it("returns array of unique agent names", () => {
    const result = extractAgentNames("@engineer @security @engineer");
    expect(result).toEqual(["engineer", "security"]);
  });

  it("respects self-mention filter", () => {
    const result = extractAgentNames("@captain @engineer @security", "captain");
    expect(result).toEqual(["engineer", "security"]);
  });
});
