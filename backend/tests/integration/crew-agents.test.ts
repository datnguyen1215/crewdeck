import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { getApp } from "./setup.js";

let app: Express;

beforeAll(async () => {
  app = await getApp();
});

describe("GET /api/v1/crew", () => {
  it("returns the fixed 5-member crew", async () => {
    const res = await request(app).get("/api/v1/crew");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
    expect(res.body.map((a: { id: string }) => a.id).sort()).toEqual([
      "captain",
      "docs",
      "engineer",
      "lead",
      "librarian",
    ]);
  });
});

describe("GET /api/v1/agents", () => {
  it("returns the same fixed crew", async () => {
    const res = await request(app).get("/api/v1/agents");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
  });
});

describe("CRUD endpoints are removed", () => {
  it("POST /crew returns 404", async () => {
    const res = await request(app)
      .post("/api/v1/crew")
      .send({ name: "Agent", title: "dev", system_prompt: "prompt" });
    expect(res.status).toBe(404);
  });

  it("PATCH /crew/:id returns 404", async () => {
    const res = await request(app)
      .patch("/api/v1/crew/captain")
      .send({ name: "Nope" });
    expect(res.status).toBe(404);
  });

  it("DELETE /crew/:id returns 404", async () => {
    const res = await request(app).delete("/api/v1/crew/captain");
    expect(res.status).toBe(404);
  });
});
