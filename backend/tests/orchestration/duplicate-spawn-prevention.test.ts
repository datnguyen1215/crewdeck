import { describe, it, expect, beforeEach } from "vitest";
import {
  hasActiveAgentProcess,
  markPendingSpawn,
  clearPendingSpawn,
} from "../../src/orchestration/processes.js";

describe("Duplicate spawn prevention", () => {
  const agentId = "captain";
  const issueId = "test-issue-123";

  beforeEach(() => {
    // Clean up any pending spawns from previous tests
    clearPendingSpawn(agentId, issueId);
  });

  it("should prevent duplicate spawns with pending marker", () => {
    // First event checks and marks as pending
    expect(hasActiveAgentProcess(agentId, issueId)).toBe(false);
    expect(markPendingSpawn(agentId, issueId)).toBe(true);

    // Second event (racing) should now see it as pending
    expect(hasActiveAgentProcess(agentId, issueId)).toBe(true);
    expect(markPendingSpawn(agentId, issueId)).toBe(false);

    // Clean up
    clearPendingSpawn(agentId, issueId);
    expect(hasActiveAgentProcess(agentId, issueId)).toBe(false);
  });

  it("should allow spawn after clearing pending marker", () => {
    // Mark as pending
    expect(markPendingSpawn(agentId, issueId)).toBe(true);
    expect(hasActiveAgentProcess(agentId, issueId)).toBe(true);

    // Clear pending
    clearPendingSpawn(agentId, issueId);

    // Should now allow another spawn
    expect(hasActiveAgentProcess(agentId, issueId)).toBe(false);
    expect(markPendingSpawn(agentId, issueId)).toBe(true);

    // Clean up
    clearPendingSpawn(agentId, issueId);
  });

  it("should handle multiple agent/issue pairs independently", () => {
    const agent2 = "engineer";
    const issue2 = "test-issue-456";

    // Mark first pair as pending
    expect(markPendingSpawn(agentId, issueId)).toBe(true);
    expect(hasActiveAgentProcess(agentId, issueId)).toBe(true);

    // Second pair should be independent
    expect(hasActiveAgentProcess(agent2, issue2)).toBe(false);
    expect(markPendingSpawn(agent2, issue2)).toBe(true);
    expect(hasActiveAgentProcess(agent2, issue2)).toBe(true);

    // Clean up
    clearPendingSpawn(agentId, issueId);
    clearPendingSpawn(agent2, issue2);
  });
});
