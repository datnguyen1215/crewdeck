import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { getApp } from "./setup.js";

// Mock ensureCloned so integration tests don't attempt real git clone via SSH
vi.mock("../../src/db/repositories/repos.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/db/repositories/repos.js")>();
  return { ...actual, ensureCloned: vi.fn() };
});

const BASE = "/api/v1/github-accounts";

const validAccount = {
  account_name: "testuser",
  github_username: "testuser",
  gh_token: "ghp_test123",
  ssh_private_key:
    "-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----",
};

describe("GitHub Accounts API", () => {
  let app: Express;

  beforeAll(async () => {
    app = await getApp();
  });

  describe("POST /", () => {
    it("creates an account and returns it without secrets", async () => {
      const res = await request(app).post(BASE).send(validAccount);
      expect(res.status).toBe(201);
      expect(res.body.github_username).toBe("testuser");
      expect(res.body.id).toBeDefined();
      // Secrets must NOT be in the response, ssh_configured should be present
      expect(res.body.gh_token).toBeUndefined();
      expect(res.body.ssh_private_key).toBeUndefined();
      expect(res.body.ssh_configured).toBe(true);
    });

    it("rejects missing fields with 400", async () => {
      const res = await request(app).post(BASE).send({ account_name: "test" });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /", () => {
    it("returns accounts without secrets", async () => {
      await request(app)
        .post(BASE)
        .send({ ...validAccount, github_username: "listuser" });

      const res = await request(app).get(BASE);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const account = res.body.find(
        (a: { github_username: string }) => a.github_username === "listuser",
      );
      expect(account).toBeDefined();
      expect(account.gh_token).toBeUndefined();
      expect(account.ssh_private_key).toBeUndefined();
    });
  });

  describe("DELETE /:id", () => {
    it("deletes an account and returns 204", async () => {
      const created = await request(app)
        .post(BASE)
        .send({ ...validAccount, github_username: "deluser" });

      const res = await request(app).delete(`${BASE}/${created.body.id}`);
      expect(res.status).toBe(204);

      // Verify it's gone
      const list = await request(app).get(BASE);
      const found = list.body.find(
        (a: { id: string }) => a.id === created.body.id,
      );
      expect(found).toBeUndefined();
    });

    it("returns 404 for non-existent id", async () => {
      const res = await request(app).delete(`${BASE}/nonexistent-uuid`);
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /:id", () => {
    it("updates a single field and returns account without secrets", async () => {
      const created = await request(app)
        .post(BASE)
        .send({ ...validAccount, github_username: "patchuser" });

      const res = await request(app)
        .patch(`${BASE}/${created.body.id}`)
        .send({ account_name: "updated-name" });

      expect(res.status).toBe(200);
      expect(res.body.account_name).toBe("updated-name");
      expect(res.body.github_username).toBe("patchuser");
      expect(res.body.gh_token).toBeUndefined();
      expect(res.body.ssh_private_key).toBeUndefined();
    });

    it("returns 404 for non-existent id", async () => {
      const res = await request(app)
        .patch(`${BASE}/nonexistent-uuid`)
        .send({ account_name: "x" });
      expect(res.status).toBe(404);
    });

    it("rejects empty strings via validation", async () => {
      const created = await request(app)
        .post(BASE)
        .send({ ...validAccount, github_username: "valuser" });

      const res = await request(app)
        .patch(`${BASE}/${created.body.id}`)
        .send({ account_name: "" });
      expect(res.status).toBe(400);
    });
  });

  describe("Project with github_account_id", () => {
    it("creates a project with github_account_id and persists it", async () => {
      const account = await request(app)
        .post(BASE)
        .send({ ...validAccount, github_username: "projuser" });

      const project = await request(app)
        .post("/api/v1/projects")
        .send({
          name: `gh-acct-test-${Date.now()}`,
          github_url: "https://github.com/test/repo",
          github_account_id: account.body.id,
        });

      expect(project.status).toBe(201);
      expect(project.body.github_account_id).toBe(account.body.id);
    });

    it("nullifies github_account_id when the account is deleted", async () => {
      const account = await request(app)
        .post(BASE)
        .send({ ...validAccount, github_username: "cascadeuser" });

      const project = await request(app)
        .post("/api/v1/projects")
        .send({
          name: `cascade-test-${Date.now()}`,
          github_url: "https://github.com/test/repo",
          github_account_id: account.body.id,
        });
      expect(project.body.github_account_id).toBe(account.body.id);

      // Delete the account
      await request(app).delete(`${BASE}/${account.body.id}`);

      // Verify project's github_account_id is now null
      const updated = await request(app).get(
        `/api/v1/projects/${project.body.id}`,
      );
      expect(updated.body.github_account_id).toBeNull();
    });
  });
});
