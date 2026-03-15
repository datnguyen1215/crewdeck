import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { getApp } from "./setup.js";

const FAKE_PROJECT_ID = "00000000-0000-0000-0000-000000000000";
const FAKE_AGENT_ID = "00000000-0000-0000-0000-000000000000";

let app: Express;
let projectId: string;

beforeAll(async () => {
  app = await getApp();
  const res = await request(app)
    .post("/api/v1/projects")
    .send({ name: "crew-agents-test-project" });
  projectId = res.body.id;
});

describe("GET /api/v1/projects/:projectId/crew", () => {
  it("returns crew with empty agents array for new project", async () => {
    const res = await request(app).get(`/api/v1/projects/${projectId}/crew`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("id");
    expect(res.body.agents).toEqual([]);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(app).get(
      `/api/v1/projects/${FAKE_PROJECT_ID}/crew`,
    );
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/v1/projects/:projectId/crew", () => {
  it("updates crew fields", async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/crew`)
      .send({ name: "Updated Crew" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Crew");
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${FAKE_PROJECT_ID}/crew`)
      .send({ name: "Nope" });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/projects/:projectId/crew/agents", () => {
  it("returns empty array when no agents", async () => {
    const res = await request(app).get(
      `/api/v1/projects/${projectId}/crew/agents`,
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
        role: "developer",
        system_prompt: "You are a dev",
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body.name).toBe("Agent One");
    expect(res.body.role).toBe("developer");
    expect(res.body).toHaveProperty("expertise");
  });

  it("validates required fields", async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/crew/agents`)
      .send({ name: "Missing fields" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${FAKE_PROJECT_ID}/crew/agents`)
      .send({ name: "Agent", role: "dev", system_prompt: "prompt" });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/projects/:projectId/crew/agents (after creation)", () => {
  it("returns agents after creating some", async () => {
    const res = await request(app).get(
      `/api/v1/projects/${projectId}/crew/agents`,
    );
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /api/v1/projects/:projectId/crew (with agents)", () => {
  it("returns crew with agents after adding some", async () => {
    const res = await request(app).get(`/api/v1/projects/${projectId}/crew`);
    expect(res.status).toBe(200);
    expect(res.body.agents.length).toBeGreaterThanOrEqual(1);
  });
});

describe("PATCH /api/v1/projects/:projectId/crew/agents/:agentId", () => {
  let agentId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/crew/agents`)
      .send({
        name: "Patchable",
        role: "tester",
        system_prompt: "test prompt",
      });
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
      .patch(`/api/v1/projects/${projectId}/crew/agents/${FAKE_AGENT_ID}`)
      .send({ name: "Nope" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/projects/:projectId/crew/agents/:agentId", () => {
  let agentId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/crew/agents`)
      .send({ name: "Deletable", role: "disposable", system_prompt: "bye" });
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
      `/api/v1/projects/${projectId}/crew/agents/${FAKE_AGENT_ID}`,
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/projects/:projectId/crew/agents/:agentId (conflict)", () => {
  let agentId: string;

  beforeAll(async () => {
    // Create an agent
    const agentRes = await request(app)
      .post(`/api/v1/projects/${projectId}/crew/agents`)
      .send({ name: "Busy Agent", role: "worker", system_prompt: "working" });
    agentId = agentRes.body.id;

    // Create an issue
    const issueRes = await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .send({ title: "Blocking issue", description: "blocks deletion" });
    const issueId = issueRes.body.id;

    // Assign agent and set status to open (non-terminal)
    await request(app)
      .patch(`/api/v1/projects/${projectId}/issues/${issueId}`)
      .send({ assigned_agent_id: agentId, status: "open" });
  });

  it("returns 409 when agent has active issues", async () => {
    const res = await request(app).delete(
      `/api/v1/projects/${projectId}/crew/agents/${agentId}`,
    );
    expect(res.status).toBe(409);
  });
});
