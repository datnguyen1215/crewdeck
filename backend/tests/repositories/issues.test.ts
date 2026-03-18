import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import { createProject } from "../../src/db/repositories/projects.js";
import { getCrew } from "../../src/db/repositories/crews.js";
import { createAgent } from "../../src/db/repositories/agents.js";
import {
  listIssues,
  getIssue,
  getIssueWithDetails,
  createIssue,
  updateIssue,
  deleteIssue,
} from "../../src/db/repositories/issues.js";
import { createComment } from "../../src/db/repositories/comments.js";
import { createIssueAgent } from "../../src/db/repositories/issue-agents.js";
import { createRepo } from "../../src/db/repositories/repos.js";
import { createIssuePR } from "../../src/db/repositories/issue-prs.js";
import { createActivity } from "../../src/db/repositories/activity-log.js";

function clearAll() {
  db.exec("DELETE FROM ActivityLog");
  db.exec("DELETE FROM IssueAgent");
  db.exec("DELETE FROM IssuePR");
  db.exec("DELETE FROM Comment");
  db.exec("DELETE FROM Session");
  db.exec("DELETE FROM Issue");
  db.exec("DELETE FROM Agent");
  db.exec("DELETE FROM Repo");
  db.exec("DELETE FROM Crew");
  db.exec("DELETE FROM Project");
}

beforeEach(clearAll);

describe("createIssue", () => {
  it("creates an issue with defaults", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "Bug", description: "Fix me" });
    expect(issue.id).toBeTruthy();
    expect(issue.title).toBe("Bug");
    expect(issue.status).toBe("open");
    expect(issue.priority).toBe(0);
    expect(issue.created_by).toBe("user");
  });
});

describe("listIssues", () => {
  it("filters by status", () => {
    const p = createProject({ name: "P" });
    createIssue(p.id, { title: "Open", description: "D" });
    const closed = createIssue(p.id, { title: "Closed", description: "D" });
    updateIssue(closed.id, { status: "closed" });

    const open = listIssues(p.id, { status: ["open"] });
    expect(open.length).toBe(1);
    expect(open[0].title).toBe("Open");
  });

  it("filters by multiple statuses", () => {
    const p = createProject({ name: "P" });
    createIssue(p.id, { title: "A", description: "D" });
    const i2 = createIssue(p.id, { title: "B", description: "D" });
    updateIssue(i2.id, { status: "in_progress" });
    const i3 = createIssue(p.id, { title: "C", description: "D" });
    updateIssue(i3.id, { status: "closed" });

    const active = listIssues(p.id, { status: ["open", "in_progress"] });
    expect(active.length).toBe(2);
  });

  it("filters by assigned_agent_id", () => {
    const p = createProject({ name: "P" });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, { name: "A", title: "dev", system_prompt: "s" });
    const i1 = createIssue(p.id, { title: "Assigned", description: "D" });
    updateIssue(i1.id, { assigned_agent_id: agent.id });
    createIssue(p.id, { title: "Unassigned", description: "D" });

    const assigned = listIssues(p.id, { assigned_agent_id: agent.id });
    expect(assigned.length).toBe(1);
    expect(assigned[0].title).toBe("Assigned");
  });

  it("filters by created_by", () => {
    const p = createProject({ name: "P" });
    createIssue(p.id, { title: "User issue", description: "D", created_by: "user" });
    createIssue(p.id, { title: "Agent issue", description: "D", created_by: "agent" });

    expect(listIssues(p.id, { created_by: "agent" }).length).toBe(1);
  });

  it("sorts by priority ascending", () => {
    const p = createProject({ name: "P" });
    createIssue(p.id, { title: "Low", description: "D", priority: 1 });
    createIssue(p.id, { title: "High", description: "D", priority: 10 });
    createIssue(p.id, { title: "Mid", description: "D", priority: 5 });

    const sorted = listIssues(p.id, { sort: "priority", order: "asc" });
    expect(sorted[0].priority).toBe(1);
    expect(sorted[1].priority).toBe(5);
    expect(sorted[2].priority).toBe(10);
  });

  it("sorts by priority descending", () => {
    const p = createProject({ name: "P" });
    createIssue(p.id, { title: "Low", description: "D", priority: 1 });
    createIssue(p.id, { title: "High", description: "D", priority: 10 });

    const sorted = listIssues(p.id, { sort: "priority", order: "desc" });
    expect(sorted[0].priority).toBe(10);
  });
});

describe("updateIssue", () => {
  it("updates status", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const updated = updateIssue(issue.id, { status: "in_progress" });
    expect(updated.status).toBe("in_progress");
  });
});

describe("deleteIssue", () => {
  it("deletes the issue", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    deleteIssue(issue.id);
    expect(getIssue(issue.id)).toBeNull();
  });
});

describe("getIssueWithDetails", () => {
  it("returns null for missing issue", () => {
    expect(getIssueWithDetails("missing")).toBeNull();
  });

  it("returns issue with nested comments, agents, prs, activity", () => {
    const p = createProject({ name: "P" });
    const repo = createRepo(p.id, {
      github_url: "https://github.com/acme/x",
    });
    const crew = getCrew(p.id)!;
    const agent = createAgent(crew.id, { name: "A", title: "dev", system_prompt: "s" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    updateIssue(issue.id, { assigned_agent_id: agent.id, repo_id: repo.id });

    createComment(issue.id, { content: "A comment" });
    createIssueAgent({ issue_id: issue.id, agent_id: agent.id, role: "developer" });
    createIssuePR({ issue_id: issue.id, repo_id: repo.id, pr_number: 42, pr_url: "https://github.com/acme/x/pull/42" });
    createActivity({ project_id: p.id, issue_id: issue.id, actor_type: "user", action: "created" });

    const details = getIssueWithDetails(issue.id);
    expect(details).not.toBeNull();
    expect(details!.comments.length).toBe(1);
    // Legacy fields
    expect(details!.agents.length).toBe(1);
    expect(details!.prs.length).toBe(1);
    expect(details!.activity.length).toBe(1);

    // Renamed fields
    expect(details!.issue_agents.length).toBe(1);
    expect(details!.issue_agents[0].agent).toEqual({ id: agent.id, name: "A" });
    expect(details!.issue_prs.length).toBe(1);
    expect(details!.activity_log.length).toBe(1);
    expect(details!.assigned_agent).toEqual({ id: agent.id, name: "A" });
    expect(details!.repo).toEqual({ id: repo.id, name: "x" });
  });
});
