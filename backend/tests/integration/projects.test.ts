import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { execFileSync } from "node:child_process";
import { getApp } from "./setup.js";

const BASE = "/api/v1/projects";

// Use a unique prefix to avoid collisions with other test files sharing the DB
const prefix = `test-${Date.now()}`;
const name = (label: string) => `${prefix}-${label}`;

describe("Projects CRUD", () => {
  let app: Express;

  beforeAll(async () => {
    app = await getApp();
  });

  describe("GET /api/v1/projects", () => {
    it("returns an array", async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("returns created projects", async () => {
      const a = await request(app)
        .post(BASE)
        .send({ name: name("list-a"), github_url: "https://github.com/test/repo" });
      expect(a.status).toBe(201);
      const b = await request(app)
        .post(BASE)
        .send({ name: name("list-b"), github_url: "https://github.com/test/repo" });
      expect(b.status).toBe(201);

      const res = await request(app).get(BASE);
      const names = res.body.map((p: { name: string }) => p.name);
      expect(names).toContain(name("list-a"));
      expect(names).toContain(name("list-b"));
    });
  });

  describe("POST /api/v1/projects", () => {
    it("creates a project with valid body", async () => {
      const res = await request(app)
        .post(BASE)
        .send({ name: name("create"), description: "desc", github_url: "https://github.com/test/repo" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: name("create"),
        description: "desc",
      });
      expect(res.body.id).toBeDefined();
      expect(res.body.created_at).toBeDefined();
      expect(res.body.updated_at).toBeDefined();
    });

    it("rejects missing github_url with 400", async () => {
      const res = await request(app).post(BASE).send({});
      expect(res.status).toBe(400);
    });

    it("rejects empty name with 400", async () => {
      const res = await request(app).post(BASE).send({ name: "", github_url: "https://github.com/test/repo" });
      expect(res.status).toBe(400);
    });

    it("derives name from github_url when name is omitted", async () => {
      const res = await request(app)
        .post(BASE)
        .send({ github_url: "https://github.com/test/my-project" });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("my-project");
    });

    it("returns 400 with message when git clone fails", async () => {
      const mock = vi.mocked(execFileSync);
      const err = Object.assign(new Error("Command failed"), {
        stderr: Buffer.from(
          "Cloning into '/tmp/repo'...\nfatal: could not read Username for 'https://github.com': No such device or address\n",
        ),
      });
      mock.mockImplementationOnce(() => { throw err; });

      const res = await request(app)
        .post(BASE)
        .send({ name: name("clone-fail"), github_url: "https://github.com/owner/repo" });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("Failed to clone repository");
      // Ensure URLs are stripped from the error message
      expect(res.body.error.message).not.toMatch(/https?:\/\/[^\s]+github/);
    });

    it("applies default values for max_concurrency and max_review_rounds", async () => {
      const res = await request(app)
        .post(BASE)
        .send({ name: name("defaults"), github_url: "https://github.com/test/repo" });
      expect(res.status).toBe(201);
      expect(typeof res.body.max_concurrency).toBe("number");
      expect(typeof res.body.max_review_rounds).toBe("number");
    });
  });

  describe("GET /api/v1/projects/:id", () => {
    it("returns a project by id", async () => {
      const created = await request(app)
        .post(BASE)
        .send({ name: name("get-by-id"), github_url: "https://github.com/test/repo" });
      expect(created.status).toBe(201);
      const res = await request(app).get(`${BASE}/${created.body.id}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(created.body.id);
      expect(res.body.name).toBe(name("get-by-id"));
    });

    it("returns 404 for non-existent id", async () => {
      const res = await request(app).get(`${BASE}/nonexistent-uuid`);
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/v1/projects/:id", () => {
    it("updates name and description", async () => {
      const created = await request(app)
        .post(BASE)
        .send({ name: name("patch"), github_url: "https://github.com/test/repo" });
      expect(created.status).toBe(201);
      const res = await request(app)
        .patch(`${BASE}/${created.body.id}`)
        .send({ name: name("patched"), description: "updated" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe(name("patched"));
      expect(res.body.description).toBe("updated");
    });

    it("returns 404 for non-existent id", async () => {
      const res = await request(app)
        .patch(`${BASE}/nonexistent-uuid`)
        .send({ name: "x" });
      expect(res.status).toBe(404);
    });

    it("rejects invalid fields with 400", async () => {
      const created = await request(app)
        .post(BASE)
        .send({ name: name("patch-bad"), github_url: "https://github.com/test/repo" });
      expect(created.status).toBe(201);
      const res = await request(app)
        .patch(`${BASE}/${created.body.id}`)
        .send({ max_concurrency: "not-a-number" });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/v1/projects/:id", () => {
    it("deletes a project and returns 204", async () => {
      const created = await request(app)
        .post(BASE)
        .send({ name: name("delete"), github_url: "https://github.com/test/repo" });
      expect(created.status).toBe(201);
      const res = await request(app).delete(`${BASE}/${created.body.id}`);
      expect(res.status).toBe(204);
    });

    it("returns 404 for non-existent id", async () => {
      const res = await request(app).delete(`${BASE}/nonexistent-uuid`);
      expect(res.status).toBe(404);
    });

    it("project is gone after deletion", async () => {
      const created = await request(app)
        .post(BASE)
        .send({ name: name("delete-verify"), github_url: "https://github.com/test/repo" });
      expect(created.status).toBe(201);
      const del = await request(app).delete(`${BASE}/${created.body.id}`);
      expect(del.status).toBe(204);

      const res = await request(app).get(`${BASE}/${created.body.id}`);
      expect(res.status).toBe(404);
    });
  });
});
