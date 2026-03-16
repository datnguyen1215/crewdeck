import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { getApp } from "./setup.js";

const FAKE_ID = "00000000-0000-0000-0000-000000000000";

let app: Express;
let projectId: string;

beforeAll(async () => {
  app = await getApp();
  const res = await request(app)
    .post("/api/v1/projects")
    .send({ name: "crew-agents-test-project", github_url: "https://github.com/test/repo" });
  expect(res.status).toBe(201);
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
    const res = await request(app).get(`/api/v1/projects/${FAKE_ID}/crew`);
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
      .patch(`/api/v1/projects/${FAKE_ID}/crew`)
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
        title: "developer",
        system_prompt: "You are a dev",
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body.name).toBe("Agent One");
    expect(res.body.title).toBe("developer");
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

describe("GET /api/v1/projects/:projectId/crew (with agents)", () => {
  beforeAll(async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/crew/agents`)
      .send({ name: "Crew Agent", title: "dev", system_prompt: "prompt" });
    expect(res.status).toBe(201);
  });

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

describe("Captain designation", () => {
  let captainProjectId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post("/api/v1/projects")
      .send({ name: "captain-test-project", github_url: "https://github.com/test/captain" });
    expect(res.status).toBe(201);
    captainProjectId = res.body.id;
  });

  it("creates agent with is_captain flag", async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${captainProjectId}/crew/agents`)
      .send({
        name: "The Captain",
        title: "coordinator",
        system_prompt: "You coordinate the crew.",
        is_captain: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.is_captain).toBe(1);
  });

  it("defaults is_captain to 0 when not provided", async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${captainProjectId}/crew/agents`)
      .send({
        name: "Regular Worker",
        title: "developer",
        system_prompt: "You write code.",
      });
    expect(res.status).toBe(201);
    expect(res.body.is_captain).toBe(0);
  });

  it("enforces one captain per crew — new captain demotes previous", async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${captainProjectId}/crew/agents`)
      .send({
        name: "New Captain",
        title: "lead",
        system_prompt: "You are the new captain.",
        is_captain: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.is_captain).toBe(1);

    // Verify only one captain exists
    const crew = await request(app).get(`/api/v1/projects/${captainProjectId}/crew`);
    expect(crew.status).toBe(200);
    const captains = crew.body.agents.filter((a: { is_captain: number }) => a.is_captain === 1);
    expect(captains).toHaveLength(1);
    expect(captains[0].name).toBe("New Captain");
  });

  it("updates agent to become captain via PATCH", async () => {
    // Create a non-captain agent
    const createRes = await request(app)
      .post(`/api/v1/projects/${captainProjectId}/crew/agents`)
      .send({
        name: "Promoted Agent",
        title: "senior dev",
        system_prompt: "You are a senior dev.",
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.is_captain).toBe(0);

    // Promote to captain
    const patchRes = await request(app)
      .patch(`/api/v1/projects/${captainProjectId}/crew/agents/${createRes.body.id}`)
      .send({ is_captain: true });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.is_captain).toBe(1);

    // Verify previous captain was demoted
    const crew = await request(app).get(`/api/v1/projects/${captainProjectId}/crew`);
    const captains = crew.body.agents.filter((a: { is_captain: number }) => a.is_captain === 1);
    expect(captains).toHaveLength(1);
    expect(captains[0].name).toBe("Promoted Agent");
  });

  it("removes captain designation via PATCH", async () => {
    const crew = await request(app).get(`/api/v1/projects/${captainProjectId}/crew`);
    const captain = crew.body.agents.find((a: { is_captain: number }) => a.is_captain === 1);
    expect(captain).toBeDefined();

    const patchRes = await request(app)
      .patch(`/api/v1/projects/${captainProjectId}/crew/agents/${captain.id}`)
      .send({ is_captain: false });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.is_captain).toBe(0);

    // No captains remain
    const updatedCrew = await request(app).get(`/api/v1/projects/${captainProjectId}/crew`);
    const captains = updatedCrew.body.agents.filter((a: { is_captain: number }) => a.is_captain === 1);
    expect(captains).toHaveLength(0);
  });
});

describe("DELETE /api/v1/projects/:projectId/crew/agents/:agentId (conflict)", () => {
  let agentId: string;

  beforeAll(async () => {
    // Create an agent
    const agentRes = await request(app)
      .post(`/api/v1/projects/${projectId}/crew/agents`)
      .send({ name: "Busy Agent", title: "worker", system_prompt: "working" });
    expect(agentRes.status).toBe(201);
    agentId = agentRes.body.id;

    // Create an issue
    const issueRes = await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .send({ title: "Blocking issue", description: "blocks deletion" });
    expect(issueRes.status).toBe(201);
    const issueId = issueRes.body.id;

    // Assign agent and set status to open (non-terminal)
    const patchRes = await request(app)
      .patch(`/api/v1/projects/${projectId}/issues/${issueId}`)
      .send({ assigned_agent_id: agentId, status: "open" });
    expect(patchRes.status).toBe(200);
  });

  it("returns 409 when agent has active issues", async () => {
    const res = await request(app).delete(
      `/api/v1/projects/${projectId}/crew/agents/${agentId}`,
    );
    expect(res.status).toBe(409);
  });
});
