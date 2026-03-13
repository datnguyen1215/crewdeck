import { describe, it, expect } from "vitest";
import {
  agentSessionName,
  orchestratorSessionName,
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
  });

  describe("orchestratorSessionName", () => {
    it("follows the crewdeck-orchestrator-<projectId-short> convention", () => {
      const name = orchestratorSessionName("proj1234-1234-1234-1234-123456789012");
      expect(name).toBe("crewdeck-orchestrator-proj1234");
    });
  });
});
