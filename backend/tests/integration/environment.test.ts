import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { getApp } from "./setup.js";

const BASE = "/api/v1/projects";

describe("Environment Variables API", () => {
  let app: Express;
  let projectId: string;

  beforeAll(async () => {
    app = await getApp();
    const res = await request(app).post(`${BASE}`).send({
      name: "env-test-project",
      github_url: "https://github.com/test/repo",
    });
    projectId = res.body.id;
  });

  describe("GET /projects/:projectId/environment", () => {
    it("returns empty array initially", async () => {
      const res = await request(app).get(`${BASE}/${projectId}/environment`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns 404 for non-existent project", async () => {
      const res = await request(app).get(`${BASE}/nonexistent/environment`);
      expect(res.status).toBe(404);
    });
  });

  describe("POST /projects/:projectId/environment", () => {
    let freshProjectId: string;

    beforeAll(async () => {
      const res = await request(app).post(`${BASE}`).send({
        name: "env-post-project",
        github_url: "https://github.com/test/repo",
      });
      freshProjectId = res.body.id;
    });

    it("creates an env var and returns 201", async () => {
      const res = await request(app)
        .post(`${BASE}/${freshProjectId}/environment`)
        .send({ key: "API_KEY", value: "abc123" });

      expect(res.status).toBe(201);
      expect(res.body.key).toBe("API_KEY");
      expect(res.body.value).toBe("abc123");
      expect(res.body.is_secret).toBe(false);
    });

    it("masks secret values in the response", async () => {
      const res = await request(app)
        .post(`${BASE}/${freshProjectId}/environment`)
        .send({ key: "SECRET_TOKEN", value: "s3cret", is_secret: true });

      expect(res.status).toBe(201);
      expect(res.body.is_secret).toBe(true);
      expect(res.body.value).toBe("••••••••");
    });

    it("rejects invalid key names", async () => {
      const res = await request(app)
        .post(`${BASE}/${freshProjectId}/environment`)
        .send({ key: "123-invalid", value: "v" });
      expect(res.status).toBe(400);
    });

    it("rejects missing key", async () => {
      const res = await request(app)
        .post(`${BASE}/${freshProjectId}/environment`)
        .send({ value: "v" });
      expect(res.status).toBe(400);
    });

    it("returns 409 for duplicate key", async () => {
      await request(app)
        .post(`${BASE}/${freshProjectId}/environment`)
        .send({ key: "DUPLICATE_KEY", value: "first" });
      const res = await request(app)
        .post(`${BASE}/${freshProjectId}/environment`)
        .send({ key: "DUPLICATE_KEY", value: "second" });
      expect(res.status).toBe(409);
    });

    it("returns 404 for non-existent project", async () => {
      const res = await request(app)
        .post(`${BASE}/nonexistent/environment`)
        .send({ key: "K", value: "v" });
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /projects/:projectId/environment/:envVarId", () => {
    let patchProjectId: string;
    let envVarId: string;

    beforeAll(async () => {
      const projRes = await request(app).post(`${BASE}`).send({
        name: "env-patch-project",
        github_url: "https://github.com/test/repo",
      });
      patchProjectId = projRes.body.id;

      const envRes = await request(app)
        .post(`${BASE}/${patchProjectId}/environment`)
        .send({ key: "PATCH_KEY", value: "original" });
      envVarId = envRes.body.id;
    });

    it("updates value", async () => {
      const res = await request(app)
        .patch(`${BASE}/${patchProjectId}/environment/${envVarId}`)
        .send({ value: "updated" });
      expect(res.status).toBe(200);
      expect(res.body.value).toBe("updated");
    });

    it("returns 404 for env var in different project", async () => {
      const otherRes = await request(app).post(`${BASE}`).send({
        name: "env-other-project",
        github_url: "https://github.com/test/repo",
      });
      const res = await request(app)
        .patch(`${BASE}/${otherRes.body.id}/environment/${envVarId}`)
        .send({ value: "hacked" });
      expect(res.status).toBe(404);
    });

    it("returns 409 when updating key to one that already exists", async () => {
      const envRes = await request(app)
        .post(`${BASE}/${patchProjectId}/environment`)
        .send({ key: "EXISTING_KEY", value: "taken" });
      expect(envRes.status).toBe(201);

      const res = await request(app)
        .patch(`${BASE}/${patchProjectId}/environment/${envVarId}`)
        .send({ key: "EXISTING_KEY" });
      expect(res.status).toBe(409);
    });

    it("returns 404 for non-existent env var", async () => {
      const res = await request(app)
        .patch(`${BASE}/${patchProjectId}/environment/nonexistent`)
        .send({ value: "v" });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /projects/:projectId/environment/:envVarId", () => {
    let deleteProjectId: string;
    let envVarId: string;

    beforeAll(async () => {
      const projRes = await request(app).post(`${BASE}`).send({
        name: "env-delete-project",
        github_url: "https://github.com/test/repo",
      });
      deleteProjectId = projRes.body.id;

      const envRes = await request(app)
        .post(`${BASE}/${deleteProjectId}/environment`)
        .send({ key: "DELETE_KEY", value: "doomed" });
      envVarId = envRes.body.id;
    });

    it("deletes and returns 204", async () => {
      const res = await request(app).delete(
        `${BASE}/${deleteProjectId}/environment/${envVarId}`,
      );
      expect(res.status).toBe(204);
    });

    it("verifies env var is gone after deletion", async () => {
      const res = await request(app).get(
        `${BASE}/${deleteProjectId}/environment`,
      );
      expect(res.body).toEqual([]);
    });

    it("returns 404 for env var in different project", async () => {
      const otherRes = await request(app).post(`${BASE}`).send({
        name: "env-del-other",
        github_url: "https://github.com/test/repo",
      });
      const envRes = await request(app)
        .post(`${BASE}/${otherRes.body.id}/environment`)
        .send({ key: "OTHER_KEY", value: "v" });

      const res = await request(app).delete(
        `${BASE}/${deleteProjectId}/environment/${envRes.body.id}`,
      );
      expect(res.status).toBe(404);
    });
  });

  describe("secret masking on GET", () => {
    it("masks secret values but shows non-secret values", async () => {
      const projRes = await request(app).post(`${BASE}`).send({
        name: "env-mask-project",
        github_url: "https://github.com/test/repo",
      });
      const pid = projRes.body.id;

      await request(app)
        .post(`${BASE}/${pid}/environment`)
        .send({ key: "PUBLIC_VAR", value: "visible" });
      await request(app)
        .post(`${BASE}/${pid}/environment`)
        .send({ key: "SECRET_VAR", value: "hidden", is_secret: true });

      const res = await request(app).get(`${BASE}/${pid}/environment`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      const publicVar = res.body.find(
        (v: { key: string }) => v.key === "PUBLIC_VAR",
      );
      const secretVar = res.body.find(
        (v: { key: string }) => v.key === "SECRET_VAR",
      );

      expect(publicVar.value).toBe("visible");
      expect(secretVar.value).toBe("••••••••");
    });
  });
});
