import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { getApp } from "./setup.js";

// Mock external GitHub API calls — the routes import device-flow functions
vi.mock("../../src/github/device-flow.js", () => ({
  requestDeviceCode: vi.fn(),
  pollForToken: vi.fn(),
  getGitHubUsername: vi.fn(),
  revokeToken: vi.fn(),
}));

// Mock config so we control client_id/secret values
vi.mock("../../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config.js")>();
  return {
    ...actual,
    config: {
      ...actual.config,
      githubClientId: "test-client-id",
      githubClientSecret: "test-client-secret",
    },
  };
});

import * as deviceFlow from "../../src/github/device-flow.js";

const BASE = "/api/v1/github-accounts";

describe("GitHub Accounts API", () => {
  let app: Express;

  beforeAll(async () => {
    app = await getApp();
  });

  describe("POST /device-code", () => {
    it("initiates device flow and returns device code response", async () => {
      vi.mocked(deviceFlow.requestDeviceCode).mockResolvedValueOnce({
        device_code: "dc_123",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      });

      const res = await request(app).post(`${BASE}/device-code`).send({});
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        device_code: "dc_123",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
      });
    });

    it("returns 400 when no client_id configured and none provided", async () => {
      // Temporarily override config to have no client_id
      const configMod = await import("../../src/config.js");
      const original = configMod.config.githubClientId;
      configMod.config.githubClientId = "";

      const res = await request(app).post(`${BASE}/device-code`).send({});
      expect(res.status).toBe(400);

      configMod.config.githubClientId = original;
    });
  });

  describe("POST /device-code/poll", () => {
    it("returns pending status when authorization_pending", async () => {
      vi.mocked(deviceFlow.pollForToken).mockResolvedValueOnce({
        error: "authorization_pending",
        error_description: "The authorization request is still pending.",
      });

      const res = await request(app)
        .post(`${BASE}/device-code/poll`)
        .send({ device_code: "dc_123" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: "pending",
        error: "authorization_pending",
      });
    });

    it("creates account and returns 201 when token is obtained", async () => {
      vi.mocked(deviceFlow.pollForToken).mockResolvedValueOnce({
        access_token: "gho_token123",
        token_type: "bearer",
        scope: "repo",
      });
      vi.mocked(deviceFlow.getGitHubUsername).mockResolvedValueOnce("octocat");

      const res = await request(app)
        .post(`${BASE}/device-code/poll`)
        .send({ device_code: "dc_123" });

      expect(res.status).toBe(201);
      expect(res.body.github_username).toBe("octocat");
      expect(res.body.id).toBeDefined();
      // Token must NOT be in the response
      expect(res.body.oauth_token).toBeUndefined();
    });

    it("rejects missing device_code with 400", async () => {
      const res = await request(app)
        .post(`${BASE}/device-code/poll`)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe("GET /", () => {
    it("returns accounts without oauth_token", async () => {
      // Create an account via the poll endpoint first
      vi.mocked(deviceFlow.pollForToken).mockResolvedValueOnce({
        access_token: "gho_list_test",
        token_type: "bearer",
        scope: "repo",
      });
      vi.mocked(deviceFlow.getGitHubUsername).mockResolvedValueOnce("listuser");

      await request(app)
        .post(`${BASE}/device-code/poll`)
        .send({ device_code: "dc_list" });

      const res = await request(app).get(BASE);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const account = res.body.find((a: { github_username: string }) => a.github_username === "listuser");
      expect(account).toBeDefined();
      expect(account.oauth_token).toBeUndefined();
    });
  });

  describe("DELETE /:id", () => {
    it("deletes an account and returns 204", async () => {
      // Create an account
      vi.mocked(deviceFlow.pollForToken).mockResolvedValueOnce({
        access_token: "gho_delete_test",
        token_type: "bearer",
        scope: "repo",
      });
      vi.mocked(deviceFlow.getGitHubUsername).mockResolvedValueOnce("deluser");
      vi.mocked(deviceFlow.revokeToken).mockResolvedValueOnce(undefined);

      const created = await request(app)
        .post(`${BASE}/device-code/poll`)
        .send({ device_code: "dc_del" });

      const res = await request(app).delete(`${BASE}/${created.body.id}`);
      expect(res.status).toBe(204);

      // Verify it's gone
      const list = await request(app).get(BASE);
      const found = list.body.find((a: { id: string }) => a.id === created.body.id);
      expect(found).toBeUndefined();
    });

    it("returns 404 for non-existent id", async () => {
      const res = await request(app).delete(`${BASE}/nonexistent-uuid`);
      expect(res.status).toBe(404);
    });

    it("still deletes even if token revocation fails", async () => {
      vi.mocked(deviceFlow.pollForToken).mockResolvedValueOnce({
        access_token: "gho_revoke_fail",
        token_type: "bearer",
        scope: "repo",
      });
      vi.mocked(deviceFlow.getGitHubUsername).mockResolvedValueOnce("revokefail");
      vi.mocked(deviceFlow.revokeToken).mockRejectedValueOnce(new Error("revocation failed"));

      const created = await request(app)
        .post(`${BASE}/device-code/poll`)
        .send({ device_code: "dc_revfail" });

      const res = await request(app).delete(`${BASE}/${created.body.id}`);
      expect(res.status).toBe(204);
    });
  });

  describe("Project with github_account_id", () => {
    it("creates a project with github_account_id and persists it", async () => {
      // Create a GitHub account
      vi.mocked(deviceFlow.pollForToken).mockResolvedValueOnce({
        access_token: "gho_proj_test",
        token_type: "bearer",
        scope: "repo",
      });
      vi.mocked(deviceFlow.getGitHubUsername).mockResolvedValueOnce("projuser");

      const account = await request(app)
        .post(`${BASE}/device-code/poll`)
        .send({ device_code: "dc_proj" });

      const project = await request(app)
        .post("/api/v1/projects")
        .send({ name: `gh-acct-test-${Date.now()}`, github_url: "https://github.com/test/repo", github_account_id: account.body.id });

      expect(project.status).toBe(201);
      expect(project.body.github_account_id).toBe(account.body.id);
    });

    it("nullifies github_account_id when the account is deleted", async () => {
      vi.mocked(deviceFlow.pollForToken).mockResolvedValueOnce({
        access_token: "gho_cascade_test",
        token_type: "bearer",
        scope: "repo",
      });
      vi.mocked(deviceFlow.getGitHubUsername).mockResolvedValueOnce("cascadeuser");
      vi.mocked(deviceFlow.revokeToken).mockResolvedValueOnce(undefined);

      const account = await request(app)
        .post(`${BASE}/device-code/poll`)
        .send({ device_code: "dc_cascade" });

      const project = await request(app)
        .post("/api/v1/projects")
        .send({ name: `cascade-test-${Date.now()}`, github_url: "https://github.com/test/repo", github_account_id: account.body.id });
      expect(project.body.github_account_id).toBe(account.body.id);

      // Delete the account
      await request(app).delete(`${BASE}/${account.body.id}`);

      // Verify project's github_account_id is now null
      const updated = await request(app).get(`/api/v1/projects/${project.body.id}`);
      expect(updated.body.github_account_id).toBeNull();
    });
  });
});
