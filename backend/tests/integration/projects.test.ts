import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { execFileSync } from "node:child_process";
import { getApp } from "./setup.js";

vi.mock("../../src/vcs/resolve-repo-metadata.js", () => ({
  resolveRepoMetadata: vi.fn(async (_url: string) => ({
    name: "repo",
    description: null,
    default_branch: "main",
  })),
}));

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
        .send({ name: name("list-a"), repo_url: "https://github.com/test/repo" });
      expect(a.status).toBe(201);
      const b = await request(app)
        .post(BASE)
        .send({ name: name("list-b"), repo_url: "https://github.com/test/repo" });
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
        .send({ name: name("create"), description: "desc", repo_url: "https://github.com/test/repo" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: name("create"),
        description: "desc",
      });
      expect(res.body.id).toBeDefined();
      expect(res.body.created_at).toBeDefined();
      expect(res.body.updated_at).toBeDefined();
    });

    it("rejects missing repo_url with 400", async () => {
      const res = await request(app).post(BASE).send({});
      expect(res.status).toBe(400);
    });

    it("rejects empty name with 400", async () => {
      const res = await request(app).post(BASE).send({ name: "", repo_url: "https://github.com/test/repo" });
      expect(res.status).toBe(400);
    });

    it("derives name from repo_url when name is omitted", async () => {
      const res = await request(app)
        .post(BASE)
        .send({ repo_url: "https://github.com/test/my-project" });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("my-project");
    });

    it("sets default_base_branch from GitHub metadata (develop)", async () => {
      const { resolveRepoMetadata } = await import("../../src/vcs/resolve-repo-metadata.js");
      vi.mocked(resolveRepoMetadata).mockResolvedValueOnce({
        name: "my-repo",
        description: null,
        default_branch: "develop",
      });

      const res = await request(app)
        .post(BASE)
        .send({ name: name("develop-branch"), repo_url: "https://github.com/test/my-repo" });

      expect(res.status).toBe(201);
      expect(res.body.default_base_branch).toBe("develop");
    });

    it("sets default_base_branch to main when metadata returns main", async () => {
      const { resolveRepoMetadata } = await import("../../src/vcs/resolve-repo-metadata.js");
      vi.mocked(resolveRepoMetadata).mockResolvedValueOnce({
        name: "my-repo",
        description: null,
        default_branch: "main",
      });

      const res = await request(app)
        .post(BASE)
        .send({ name: name("main-branch"), repo_url: "https://github.com/test/my-repo" });

      expect(res.status).toBe(201);
      expect(res.body.default_base_branch).toBe("main");
    });

    it("falls back to main when metadata resolution returns default fallback", async () => {
      const { resolveRepoMetadata } = await import("../../src/vcs/resolve-repo-metadata.js");
      vi.mocked(resolveRepoMetadata).mockResolvedValueOnce({
        name: "my-repo",
        description: null,
        default_branch: "main",
      });

      const res = await request(app)
        .post(BASE)
        .send({ name: name("fallback-branch"), repo_url: "https://github.com/test/my-repo" });

      expect(res.status).toBe(201);
      expect(res.body.default_base_branch).toBe("main");
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
        .send({ name: name("clone-fail"), repo_url: "https://github.com/owner/repo" });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("Failed to clone repository");
      // Ensure URLs are stripped from the error message
      expect(res.body.error.message).not.toMatch(/https?:\/\/[^\s]+github/);
    });

  });

  describe("GET /api/v1/projects/:id", () => {
    it("returns a project by id", async () => {
      const created = await request(app)
        .post(BASE)
        .send({ name: name("get-by-id"), repo_url: "https://github.com/test/repo" });
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
        .send({ name: name("patch"), repo_url: "https://github.com/test/repo" });
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
        .send({ name: name("patch-bad"), repo_url: "https://github.com/test/repo" });
      expect(created.status).toBe(201);
      const res = await request(app)
        .patch(`${BASE}/${created.body.id}`)
        .send({ name: "" });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/v1/projects/:id", () => {
    it("deletes a project and returns 204", async () => {
      const created = await request(app)
        .post(BASE)
        .send({ name: name("delete"), repo_url: "https://github.com/test/repo" });
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
        .send({ name: name("delete-verify"), repo_url: "https://github.com/test/repo" });
      expect(created.status).toBe(201);
      const del = await request(app).delete(`${BASE}/${created.body.id}`);
      expect(del.status).toBe(204);

      const res = await request(app).get(`${BASE}/${created.body.id}`);
      expect(res.status).toBe(404);
    });
  });
});
