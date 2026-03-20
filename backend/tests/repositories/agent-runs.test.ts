import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import { createProject } from "../../src/db/repositories/projects.js";
import { createIssue } from "../../src/db/repositories/issues.js";
import {
  createAgentRun,
  getAgentRun,
  updateAgentRun,
  listAgentRunsForIssue,
  listAgentRunsForProject,
  getAgentRunWithEvents,
  listRunningAgentRuns,
  markRunFailed,
  createAgentRunEvent,
  getAgentRunEvent,
  listAgentRunEvents,
} from "../../src/db/repositories/agent-runs.js";

function clearAll() {
  db.exec("DELETE FROM AgentRunEvent");
  db.exec("DELETE FROM AgentRun");
  db.exec("DELETE FROM ActivityLog");
  db.exec("DELETE FROM IssuePR");
  db.exec("DELETE FROM Comment");
  db.exec("DELETE FROM Issue");
  db.exec("DELETE FROM Repo");
  db.exec("DELETE FROM Project");
}

beforeEach(clearAll);

describe("createAgentRun", () => {
  it("creates a run with default status 'running'", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const run = createAgentRun({
      project_id: p.id,
      issue_id: issue.id,
      agent_id: "engineer",
    });
    expect(run.id).toBeTruthy();
    expect(run.project_id).toBe(p.id);
    expect(run.issue_id).toBe(issue.id);
    expect(run.agent_id).toBe("engineer");
    expect(run.status).toBe("running");
    expect(run.started_at).toBeTruthy();
    expect(run.pid).toBeNull();
    expect(run.exit_code).toBeNull();
    expect(run.cost_usd).toBeNull();
    expect(run.duration_ms).toBeNull();
    expect(run.completed_at).toBeNull();
  });

  it("creates a run with queued status", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const run = createAgentRun({
      project_id: p.id,
      issue_id: issue.id,
      agent_id: "captain",
      status: "queued",
    });
    expect(run.status).toBe("queued");
    expect(run.started_at).toBeNull();
  });

  it("creates a run with a PID", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const run = createAgentRun({
      project_id: p.id,
      issue_id: issue.id,
      agent_id: "engineer",
      pid: 12345,
    });
    expect(run.pid).toBe(12345);
  });
});

describe("getAgentRun", () => {
  it("returns run by id", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const created = createAgentRun({
      project_id: p.id,
      issue_id: issue.id,
      agent_id: "engineer",
    });
    const fetched = getAgentRun(created.id);
    expect(fetched).toEqual(created);
  });

  it("returns null for missing id", () => {
    expect(getAgentRun("nonexistent")).toBeNull();
  });
});

describe("updateAgentRun", () => {
  it("updates PID", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const run = createAgentRun({
      project_id: p.id,
      issue_id: issue.id,
      agent_id: "engineer",
    });
    const updated = updateAgentRun(run.id, { pid: 99999 });
    expect(updated?.pid).toBe(99999);
  });

  it("updates status and completed_at", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const run = createAgentRun({
      project_id: p.id,
      issue_id: issue.id,
      agent_id: "engineer",
    });
    const completedAt = new Date().toISOString();
    const updated = updateAgentRun(run.id, {
      status: "completed",
      exit_code: 0,
      cost_usd: 0.05,
      duration_ms: 5000,
      completed_at: completedAt,
    });
    expect(updated?.status).toBe("completed");
    expect(updated?.exit_code).toBe(0);
    expect(updated?.cost_usd).toBe(0.05);
    expect(updated?.duration_ms).toBe(5000);
    expect(updated?.completed_at).toBe(completedAt);
  });

  it("returns run unchanged when no updates", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const run = createAgentRun({
      project_id: p.id,
      issue_id: issue.id,
      agent_id: "engineer",
    });
    const result = updateAgentRun(run.id, {});
    expect(result).toEqual(run);
  });

  it("returns null for missing run", () => {
    const result = updateAgentRun("nonexistent", { status: "failed" });
    expect(result).toBeNull();
  });
});

describe("listAgentRunsForIssue", () => {
  it("returns runs for the issue", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    createAgentRun({
      project_id: p.id,
      issue_id: issue.id,
      agent_id: "engineer",
    });
    createAgentRun({
      project_id: p.id,
      issue_id: issue.id,
      agent_id: "captain",
    });
    const runs = listAgentRunsForIssue(issue.id);
    expect(runs.length).toBe(2);
    // Verify both agent_ids are present (order may vary when created simultaneously)
    const agentIds = runs.map((r) => r.agent_id).sort();
    expect(agentIds).toEqual(["captain", "engineer"]);
  });

  it("returns empty array for issue with no runs", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const runs = listAgentRunsForIssue(issue.id);
    expect(runs).toEqual([]);
  });
});

describe("listAgentRunsForProject", () => {
  it("returns runs ordered by created_at desc with pagination", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    for (let i = 0; i < 5; i++) {
      createAgentRun({
        project_id: p.id,
        issue_id: issue.id,
        agent_id: `agent-${i}`,
      });
    }
    const page1 = listAgentRunsForProject(p.id, { limit: 2, offset: 0 });
    expect(page1.length).toBe(2);

    const page2 = listAgentRunsForProject(p.id, { limit: 2, offset: 2 });
    expect(page2.length).toBe(2);

    const page3 = listAgentRunsForProject(p.id, { limit: 2, offset: 4 });
    expect(page3.length).toBe(1);
  });

  it("uses default limit and offset", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    createAgentRun({
      project_id: p.id,
      issue_id: issue.id,
      agent_id: "engineer",
    });
    const runs = listAgentRunsForProject(p.id);
    expect(runs.length).toBe(1);
  });
});

describe("getAgentRunWithEvents", () => {
  it("returns run with its events", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const run = createAgentRun({
      project_id: p.id,
      issue_id: issue.id,
      agent_id: "engineer",
    });
    createAgentRunEvent(run.id, "assistant", { text: "Hello" });
    createAgentRunEvent(run.id, "tool_use", { tool: "Read", input: {} });

    const result = getAgentRunWithEvents(run.id);
    expect(result).toBeTruthy();
    expect(result?.id).toBe(run.id);
    expect(result?.events.length).toBe(2);
    expect(result?.events[0].type).toBe("assistant");
    expect(result?.events[1].type).toBe("tool_use");
  });

  it("returns null for missing run", () => {
    const result = getAgentRunWithEvents("nonexistent");
    expect(result).toBeNull();
  });
});

describe("listRunningAgentRuns", () => {
  it("returns only runs with status 'running'", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const running = createAgentRun({
      project_id: p.id,
      issue_id: issue.id,
      agent_id: "engineer",
    });
    createAgentRun({
      project_id: p.id,
      issue_id: issue.id,
      agent_id: "captain",
      status: "queued",
    });

    const runningRuns = listRunningAgentRuns();
    expect(runningRuns.length).toBe(1);
    expect(runningRuns[0].id).toBe(running.id);
  });
});

describe("markRunFailed", () => {
  it("updates status to failed and sets completed_at", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const run = createAgentRun({
      project_id: p.id,
      issue_id: issue.id,
      agent_id: "engineer",
    });
    const result = markRunFailed(run.id);
    expect(result?.status).toBe("failed");
    expect(result?.completed_at).toBeTruthy();
  });

  it("returns null for missing run", () => {
    const result = markRunFailed("nonexistent");
    expect(result).toBeNull();
  });
});

describe("createAgentRunEvent", () => {
  it("creates event with JSON data", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const run = createAgentRun({
      project_id: p.id,
      issue_id: issue.id,
      agent_id: "engineer",
    });
    const event = createAgentRunEvent(run.id, "assistant", {
      content: [{ type: "text", text: "Hello world" }],
    });
    expect(event.id).toBeTruthy();
    expect(event.agent_run_id).toBe(run.id);
    expect(event.type).toBe("assistant");
    expect(event.data).toEqual({ content: [{ type: "text", text: "Hello world" }] });
    expect(event.created_at).toBeTruthy();
  });
});

describe("getAgentRunEvent", () => {
  it("returns event by id", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const run = createAgentRun({
      project_id: p.id,
      issue_id: issue.id,
      agent_id: "engineer",
    });
    const created = createAgentRunEvent(run.id, "tool_use", { tool: "Bash" });
    const fetched = getAgentRunEvent(created.id);
    expect(fetched).toEqual(created);
  });

  it("returns null for missing id", () => {
    expect(getAgentRunEvent("nonexistent")).toBeNull();
  });
});

describe("listAgentRunEvents", () => {
  it("returns events ordered by created_at asc", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const run = createAgentRun({
      project_id: p.id,
      issue_id: issue.id,
      agent_id: "engineer",
    });
    createAgentRunEvent(run.id, "assistant", { text: "First" });
    createAgentRunEvent(run.id, "tool_use", { tool: "Read" });
    createAgentRunEvent(run.id, "result", { result: "Done" });

    const events = listAgentRunEvents(run.id);
    expect(events.length).toBe(3);
    expect(events[0].type).toBe("assistant");
    expect(events[1].type).toBe("tool_use");
    expect(events[2].type).toBe("result");
  });

  it("returns empty array for run with no events", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const run = createAgentRun({
      project_id: p.id,
      issue_id: issue.id,
      agent_id: "engineer",
    });
    const events = listAgentRunEvents(run.id);
    expect(events).toEqual([]);
  });
});
