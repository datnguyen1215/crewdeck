import { describe, it, expect } from "vitest";
import {
  agentSessionName,
  orchestratorSessionName,
  CREWDECK_SESSION_PREFIX,
} from "../../src/agent/types.js";

describe("session naming", () => {
  describe("agentSessionName", () => {
    it("follows the crewdeck-<issueId-short>-<agentId-short>-<role> convention", () => {
      const name = agentSessionName(
        "abc12345-1234-1234-1234-123456789012",
        "def67890-1234-1234-1234-123456789012",
        "developer"
      );
      expect(name).toBe("crewdeck-abc12345-def67890-developer");
    });

    it("uses the first 8 characters of each ID", () => {
      const name = agentSessionName("xxxxxxxx-xxxx-xxxx", "yyyyyyyy-yyyy-yyyy", "reviewer");
      expect(name).toContain("xxxxxxxx");
      expect(name).toContain("yyyyyyyy");
    });

    it("starts with the crewdeck prefix", () => {
      const name = agentSessionName("issue-id", "agent-id", "developer");
      expect(name.startsWith(CREWDECK_SESSION_PREFIX)).toBe(true);
    });

    it("includes the role in the session name", () => {
      const name = agentSessionName("i1", "a1", "reviewer");
      expect(name).toContain("reviewer");
    });
  });

  describe("orchestratorSessionName", () => {
    it("follows the crewdeck-orchestrator-<projectId-short> convention", () => {
      const name = orchestratorSessionName("proj1234-1234-1234-1234-123456789012");
      expect(name).toBe("crewdeck-orchestrator-proj1234");
    });

    it("starts with the crewdeck prefix", () => {
      const name = orchestratorSessionName("some-project-id");
      expect(name.startsWith(CREWDECK_SESSION_PREFIX)).toBe(true);
    });

    it("includes 'orchestrator' in the name", () => {
      const name = orchestratorSessionName("proj-id");
      expect(name).toContain("orchestrator");
    });
  });
});
