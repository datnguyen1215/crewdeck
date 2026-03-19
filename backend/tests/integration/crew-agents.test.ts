import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { getApp } from "./setup.js";

const FAKE_ID = "00000000-0000-0000-0000-000000000000";

let app: Express;
let projectId: string;

beforeAll(async () => {
  app = await getApp();
  const res = await request(app).post("/api/v1/projects").send({
    name: "crew-agents-test-project",
    github_url: "https://github.com/test/repo",
  });
  expect(res.status).toBe(201);
  projectId = res.body.id;
});

describe("GET /api/v1/projects/:projectId/crew/agents", () => {
  it("returns empty array for new project", async () => {
    const proj = await request(app).post("/api/v1/projects").send({
      name: "crew-agents-empty-project",
      github_url: "https://github.com/test/repo",
    });
    const res = await request(app).get(
      `/api/v1/projects/${proj.body.id}/crew/agents`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("POST /api/v1/projects/:projectId/crew/agents", () => {
  it("creates agent with valid body", async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/crew/agents`)
      .send({
        name: "Agent One",
        title: "developer",
        system_prompt: "You are a dev",
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body.name).toBe("Agent One");
    expect(res.body.title).toBe("developer");
    expect(res.body.project_id).toBe(projectId);
  });

  it("validates required fields", async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/crew/agents`)
      .send({ name: "Missing fields" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${FAKE_ID}/crew/agents`)
      .send({ name: "Agent", title: "dev", system_prompt: "prompt" });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/projects/:projectId/crew/agents (after creation)", () => {
  beforeAll(async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/crew/agents`)
      .send({ name: "List Agent", title: "dev", system_prompt: "prompt" });
    expect(res.status).toBe(201);
  });

  it("returns agents after creating some", async () => {
    const res = await request(app).get(
      `/api/v1/projects/${projectId}/crew/agents`,
    );
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });
});

describe("PATCH /api/v1/projects/:projectId/crew/agents/:agentId", () => {
  let agentId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/crew/agents`)
      .send({
        name: "Patchable",
        title: "tester",
        system_prompt: "test prompt",
      });
    expect(res.status).toBe(201);
    agentId = res.body.id;
  });

  it("updates agent fields", async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/crew/agents/${agentId}`)
      .send({ name: "Patched Agent" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Patched Agent");
  });

  it("returns 404 for non-existent agent", async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/crew/agents/${FAKE_ID}`)
      .send({ name: "Nope" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/projects/:projectId/crew/agents/:agentId", () => {
  let agentId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/crew/agents`)
      .send({ name: "Deletable", title: "disposable", system_prompt: "bye" });
    expect(res.status).toBe(201);
    agentId = res.body.id;
  });

  it("deletes agent", async () => {
    const res = await request(app).delete(
      `/api/v1/projects/${projectId}/crew/agents/${agentId}`,
    );
    expect(res.status).toBe(204);
  });

  it("returns 404 for non-existent agent", async () => {
    const res = await request(app).delete(
      `/api/v1/projects/${projectId}/crew/agents/${FAKE_ID}`,
    );
    expect(res.status).toBe(404);
  });
});
