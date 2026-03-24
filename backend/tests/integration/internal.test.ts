import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { getApp } from "./setup.js";

const BASE = "/api/v1/internal";
const FAKE_ID = "00000000-0000-0000-0000-000000000000";

let app: Express;
let projectId: string;
const agentId = "engineer"; // fixed crew member
let issueId: string;

beforeAll(async () => {
  app = await getApp();

  // Create project
  const projRes = await request(app)
    .post("/api/v1/projects")
    .send({ name: `internal-test-${Date.now()}`, github_url: "https://github.com/test/repo" });
  expect(projRes.status).toBe(201);
  projectId = projRes.body.id;

  // Create issue
  const issueRes = await request(app)
    .post(`/api/v1/projects/${projectId}/issues`)
    .send({ title: "Test Issue", description: "for internal tests" });
  expect(issueRes.status).toBe(201);
  issueId = issueRes.body.id;
});

describe("POST /api/v1/internal/comment", () => {
  it("creates comment with author_type agent", async () => {
    const res = await request(app).post(`${BASE}/comment`).send({
      issue_id: issueId,
      project_id: projectId,
      agent_id: agentId,
      content: "Agent comment here",
    });

    expect(res.status).toBe(201);
    expect(res.body.author_type).toBe("agent");
    expect(res.body.content).toBe("Agent comment here");
    expect(res.body.author_id).toBe(agentId);
  });

  it("validates issue exists and belongs to project", async () => {
    const res = await request(app).post(`${BASE}/comment`).send({
      issue_id: FAKE_ID,
      project_id: projectId,
      content: "should fail",
    });

    expect(res.status).toBe(404);
  });

  it("rejects empty content with 400", async () => {
    const res = await request(app).post(`${BASE}/comment`).send({
      issue_id: issueId,
      project_id: projectId,
      content: "",
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/internal/issues/create", () => {
  it("creates issue with created_by agent", async () => {
    const res = await request(app).post(`${BASE}/issues/create`).send({
      project_id: projectId,
      title: "Agent-created issue",
      description: "Created via internal API",
    });

    expect(res.status).toBe(201);
    expect(res.body.created_by).toBe("agent");
    expect(res.body.title).toBe("Agent-created issue");
  });

  it("validates required fields", async () => {
    const res = await request(app).post(`${BASE}/issues/create`).send({
      project_id: projectId,
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/internal/create-pr", () => {
  it("creates IssuePR record and returns 201", async () => {
    const prUrl = "https://github.com/test/repo/pull/42";
    const res = await request(app).post(`${BASE}/create-pr`).send({
      project_id: projectId,
      issue_id: issueId,
      pr_url: prUrl,
    });

    expect(res.status).toBe(201);
    expect(res.body.pr_number).toBe(42);
    expect(res.body.pr_url).toBe(prUrl);
    expect(res.body.status).toBe("open");
    expect(res.body.issue_id).toBe(issueId);
  });

  it("returns existing record on duplicate (idempotent)", async () => {
    const prUrl = "https://github.com/test/repo/pull/42";
    const res = await request(app).post(`${BASE}/create-pr`).send({
      project_id: projectId,
      issue_id: issueId,
      pr_url: prUrl,
    });

    expect(res.status).toBe(200);
    expect(res.body.pr_number).toBe(42);
  });

  it("returns 404 for non-existent issue", async () => {
    const res = await request(app).post(`${BASE}/create-pr`).send({
      project_id: projectId,
      issue_id: FAKE_ID,
      pr_url: "https://github.com/test/repo/pull/99",
    });

    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid PR URL", async () => {
    const res = await request(app).post(`${BASE}/create-pr`).send({
      project_id: projectId,
      issue_id: issueId,
      pr_url: "not-a-valid-url",
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for PR URL not matching project repo", async () => {
    const res = await request(app).post(`${BASE}/create-pr`).send({
      project_id: projectId,
      issue_id: issueId,
      pr_url: "https://github.com/other/nonexistent/pull/1",
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/internal/admiral/dispatch-agent", () => {
  it("rejects captain agent_id", async () => {
    const res = await request(app).post(`${BASE}/admiral/dispatch-agent`).send({
      project_id: projectId,
      issue_id: issueId,
      agent_id: "captain",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain("Invalid agent_id");
  });

  it("rejects admiral agent_id", async () => {
    const res = await request(app).post(`${BASE}/admiral/dispatch-agent`).send({
      project_id: projectId,
      issue_id: issueId,
      agent_id: "admiral",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain("Invalid agent_id");
  });

  it("rejects unknown agent_id", async () => {
    const res = await request(app).post(`${BASE}/admiral/dispatch-agent`).send({
      project_id: projectId,
      issue_id: issueId,
      agent_id: "nonexistent",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain("Invalid agent_id");
  });

  it("returns 400 for missing agent_id", async () => {
    const res = await request(app).post(`${BASE}/admiral/dispatch-agent`).send({
      project_id: projectId,
      issue_id: issueId,
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing issue_id", async () => {
    const res = await request(app).post(`${BASE}/admiral/dispatch-agent`).send({
      project_id: projectId,
      agent_id: "engineer",
    });

    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(app).post(`${BASE}/admiral/dispatch-agent`).send({
      project_id: FAKE_ID,
      issue_id: issueId,
      agent_id: "engineer",
    });

    expect(res.status).toBe(404);
  });

  it("returns error for non-existent issue", async () => {
    const res = await request(app).post(`${BASE}/admiral/dispatch-agent`).send({
      project_id: projectId,
      issue_id: FAKE_ID,
      agent_id: "engineer",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain("Issue not found");
  });
});
