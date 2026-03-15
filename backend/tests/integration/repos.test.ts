import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { getApp } from "./setup.js";

const BASE = "/api/v1/projects";

describe("Repos API", () => {
  let app: Express;
  let projectId: string;

  beforeAll(async () => {
    app = await getApp();
    const res = await request(app)
      .post(`${BASE}`)
      .send({ name: "repos-test-project" });
    projectId = res.body.id;
  });

  describe("GET /api/v1/projects/:projectId/repos", () => {
    it("returns empty array for project with no repos", async () => {
      const res = await request(app).get(`${BASE}/${projectId}/repos`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns repos after adding some", async () => {
      await request(app)
        .post(`${BASE}/${projectId}/repos`)
        .send({ github_url: "https://github.com/octocat/hello-world" });
      await request(app)
        .post(`${BASE}/${projectId}/repos`)
        .send({ github_url: "https://github.com/octocat/spoon-knife" });

      const res = await request(app).get(`${BASE}/${projectId}/repos`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it("returns 404 for non-existent project", async () => {
      const res = await request(app).get(`${BASE}/nonexistent-id/repos`);
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/v1/projects/:projectId/repos", () => {
    let freshProjectId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post(`${BASE}`)
        .send({ name: "repos-post-test-project" });
      freshProjectId = res.body.id;
    });

    it("creates a repo with valid body and returns 201", async () => {
      const res = await request(app)
        .post(`${BASE}/${freshProjectId}/repos`)
        .send({ github_url: "https://github.com/octocat/linguist" });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty(
        "github_url",
        "https://github.com/octocat/linguist",
      );
      expect(res.body).toHaveProperty("local_path");
    });

    it("returns 404 for non-existent project", async () => {
      const res = await request(app)
        .post(`${BASE}/nonexistent-id/repos`)
        .send({ github_url: "https://github.com/octocat/hello-world" });
      expect(res.status).toBe(404);
    });

    it("rejects missing required fields with 400", async () => {
      const res = await request(app)
        .post(`${BASE}/${freshProjectId}/repos`)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/v1/projects/:projectId/repos/:repoId", () => {
    let deleteProjectId: string;
    let repoId: string;

    beforeAll(async () => {
      const projRes = await request(app)
        .post(`${BASE}`)
        .send({ name: "repos-delete-test-project" });
      deleteProjectId = projRes.body.id;

      const repoRes = await request(app)
        .post(`${BASE}/${deleteProjectId}/repos`)
        .send({ github_url: "https://github.com/octocat/boysenberry-repo-1" });
      repoId = repoRes.body.id;
    });

    it("deletes repo and returns 204", async () => {
      const res = await request(app).delete(
        `${BASE}/${deleteProjectId}/repos/${repoId}`,
      );
      expect(res.status).toBe(204);
    });

    it("verifies repo is actually gone after deletion", async () => {
      const res = await request(app).get(`${BASE}/${deleteProjectId}/repos`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("rejects deleting a repo that belongs to a different project", async () => {
      const otherProjRes = await request(app)
        .post(`${BASE}`)
        .send({ name: "repos-other-project" });
      const otherProjectId = otherProjRes.body.id;

      const repoRes = await request(app)
        .post(`${BASE}/${otherProjectId}/repos`)
        .send({ github_url: "https://github.com/octocat/git-consortium" });
      const otherRepoId = repoRes.body.id;

      // Try to delete otherRepoId via deleteProjectId — should 404
      const res = await request(app).delete(
        `${BASE}/${deleteProjectId}/repos/${otherRepoId}`,
      );
      expect(res.status).toBe(404);
    });
  });
});
