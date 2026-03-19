import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { getApp } from "./setup.js";

const BASE = "/api/v1/internal";
const FAKE_ID = "00000000-0000-0000-0000-000000000000";

let app: Express;
let projectId: string;
let agentId: string;
let issueId: string;

beforeAll(async () => {
  app = await getApp();

  // Create project
  const projRes = await request(app)
    .post("/api/v1/projects")
    .send({ name: `internal-test-${Date.now()}`, github_url: "https://github.com/test/repo" });
  expect(projRes.status).toBe(201);
  projectId = projRes.body.id;

  // Create agent
  const agentRes = await request(app)
    .post(`/api/v1/projects/${projectId}/crew/agents`)
    .send({ name: "Test Agent", title: "developer", system_prompt: "test" });
  expect(agentRes.status).toBe(201);
  agentId = agentRes.body.id;

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

describe("POST /api/v1/internal/issues/update", () => {
  it("updates issue priority", async () => {
    const res = await request(app).post(`${BASE}/issues/update`).send({
      project_id: projectId,
      issue_id: issueId,
      priority: 5,
    });

    expect(res.status).toBe(200);
    expect(res.body.priority).toBe(5);
  });

  it("returns 404 for non-existent issue", async () => {
    const res = await request(app).post(`${BASE}/issues/update`).send({
      project_id: projectId,
      issue_id: FAKE_ID,
      priority: 1,
    });

    expect(res.status).toBe(404);
  });
});
