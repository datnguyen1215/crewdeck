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

describe("GET /api/v1/projects/:projectId/crew", () => {
  it("returns the fixed 5-member crew", async () => {
    const res = await request(app).get(
      `/api/v1/projects/${projectId}/crew`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
    expect(res.body.map((a: { id: string }) => a.id).sort()).toEqual([
      "architect",
      "captain",
      "engineer",
      "quality",
      "security",
    ]);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(app).get(
      `/api/v1/projects/${FAKE_ID}/crew`,
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/projects/:projectId/agents", () => {
  it("returns the same fixed crew", async () => {
    const res = await request(app).get(
      `/api/v1/projects/${projectId}/agents`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
  });
});

describe("CRUD endpoints are removed", () => {
  it("POST /crew returns 404", async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/crew`)
      .send({ name: "Agent", title: "dev", system_prompt: "prompt" });
    expect(res.status).toBe(404);
  });

  it("PATCH /crew/:id returns 404", async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/crew/captain`)
      .send({ name: "Nope" });
    expect(res.status).toBe(404);
  });

  it("DELETE /crew/:id returns 404", async () => {
    const res = await request(app).delete(
      `/api/v1/projects/${projectId}/crew/captain`,
    );
    expect(res.status).toBe(404);
  });
});
