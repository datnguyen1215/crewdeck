import { describe, it, expect } from "vitest";
import { buildOrchestratorPrompt, type OrchestratorState } from "../../src/orchestrator/prompt.js";
import type { Project, Issue, Agent } from "../../src/types/entities.js";

const project: Project = {
  id: "proj-1",
  name: "TestProject",
  description: null,
  max_concurrency: 2,
  max_review_rounds: 3,
  orchestrator_session_id: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

const crew = { id: "crew-1", project_id: "proj-1", name: "Alpha Crew", created_at: "2026-01-01", updated_at: "2026-01-01" };

const agentAlice: Agent = {
  id: "agent-alice-uuid",
  crew_id: "crew-1",
  name: "Alice",
  role: "backend developer",
  expertise: ["TypeScript", "Node.js"],
  system_prompt: "You are Alice",
  can_review: false,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

const agentBob: Agent = {
  id: "agent-bob-uuid",
  crew_id: "crew-1",
  name: "Bob",
  role: "reviewer",
  expertise: ["code review"],
  system_prompt: "You are Bob",
  can_review: true,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

const openIssue: Issue = {
  id: "issue-open-uuid",
  project_id: "proj-1",
  title: "Fix auth bug",
  description: "OAuth flow is broken",
  status: "open",
  priority: 10,
  assigned_agent_id: null,
  created_by: "user",
  max_review_rounds: null,
  current_review_round: 0,
  branch_name: null,
  worktree_path: null,
  base_branch: null,
  repo_id: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

const inProgressIssue: Issue = {
  ...openIssue,
  id: "issue-inprog-uuid",
  title: "Add dashboard",
  status: "in_progress",
  assigned_agent_id: "agent-alice-uuid",
};

function makeState(overrides: Partial<OrchestratorState> = {}): OrchestratorState {
  return {
    project,
    crew: { ...crew, agents: [agentAlice, agentBob] },
    openIssues: [openIssue],
    inProgressIssues: [],
    inReviewIssues: [],
    feedbackIssues: [],
    draftIssues: [],
    activeReviewerAgentIds: new Set(),
    ...overrides,
  };
}

describe("buildOrchestratorPrompt", () => {
  it("includes project concurrency info", () => {
    const prompt = buildOrchestratorPrompt(makeState(), "Test event");
    expect(prompt).toContain("Concurrency: 0/2");
    expect(prompt).toContain("Max review rounds: 3");
  });

  it("includes full UUIDs for issues and agents", () => {
    const prompt = buildOrchestratorPrompt(makeState(), "Test event");
    expect(prompt).toContain("issue-open-uuid");
    expect(prompt).toContain("agent-alice-uuid");
    expect(prompt).toContain("agent-bob-uuid");
  });

  it("includes issue titles", () => {
    const prompt = buildOrchestratorPrompt(makeState(), "Test event");
    expect(prompt).toContain("Fix auth bug");
  });

  it("shows open issues under open section", () => {
    const prompt = buildOrchestratorPrompt(makeState(), "Test event");
    expect(prompt).toContain("Open issues:");
    expect(prompt).toContain("Fix auth bug");
  });

  it("shows in-progress issues with assigned agent", () => {
    const state = makeState({ inProgressIssues: [inProgressIssue], openIssues: [] });
    const prompt = buildOrchestratorPrompt(state, "Test event");
    expect(prompt).toContain("In-progress issues:");
    expect(prompt).toContain("Add dashboard");
    expect(prompt).toContain("agent-alice-uuid");
  });

  it("shows concurrency with active issues counted", () => {
    const state = makeState({ inProgressIssues: [inProgressIssue], openIssues: [] });
    const prompt = buildOrchestratorPrompt(state, "Concurrency check");
    expect(prompt).toContain("Concurrency: 1/2");
  });

  it("includes idle agents", () => {
    // Alice is busy (in_progress issue assigned to her), Bob is idle
    const state = makeState({ inProgressIssues: [inProgressIssue], openIssues: [] });
    const prompt = buildOrchestratorPrompt(state, "Test event");
    expect(prompt).toContain("Idle agents (available to assign):");
    expect(prompt).toContain("Bob");
  });

  it("shows (none) when no idle agents", () => {
    const busyIssue = { ...openIssue, status: "in_progress", assigned_agent_id: "agent-bob-uuid" };
    const state = makeState({
      inProgressIssues: [inProgressIssue, busyIssue],
      openIssues: [],
      crew: { ...crew, agents: [agentAlice, agentBob] },
    });
    // Both agents busy
    const allIssuesWithBoth: Issue[] = [
      { ...inProgressIssue, assigned_agent_id: "agent-alice-uuid" },
      { ...inProgressIssue, id: "x", assigned_agent_id: "agent-bob-uuid" },
    ];
    const state2 = makeState({ inProgressIssues: allIssuesWithBoth, openIssues: [] });
    const prompt = buildOrchestratorPrompt(state2, "Test event");
    expect(prompt).toContain("(none)");
  });

  it("includes the event description", () => {
    const prompt = buildOrchestratorPrompt(makeState(), "A new issue was created: Fix auth bug");
    expect(prompt).toContain("A new issue was created: Fix auth bug");
  });

  it("includes agent expertise and can_review flag", () => {
    const prompt = buildOrchestratorPrompt(makeState(), "Test event");
    expect(prompt).toContain("TypeScript");
    expect(prompt).toContain("can_review: false");
    expect(prompt).toContain("can_review: true");
  });

  it("includes supported actions in instructions", () => {
    const prompt = buildOrchestratorPrompt(makeState(), "Test event");
    expect(prompt).toContain("assign");
    expect(prompt).toContain("route_review");
    expect(prompt).toContain("escalate");
    expect(prompt).toContain("create_draft_issue");
    expect(prompt).toContain("reorder");
    expect(prompt).toContain("no_action");
  });

  it("shows (none) for empty issue sections", () => {
    const prompt = buildOrchestratorPrompt(makeState({ openIssues: [] }), "Test event");
    expect(prompt).toContain("(none)");
  });
});
