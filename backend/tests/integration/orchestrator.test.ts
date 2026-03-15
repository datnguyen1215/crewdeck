import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { getApp } from "./setup.js";

const PROJECTS = "/api/v1/projects";
const prefix = `orch-${Date.now()}`;

const createProject = async (app: Express, label: string): Promise<string> => {
  const res = await request(app)
    .post(PROJECTS)
    .send({ name: `${prefix}-${label}` });
  expect(res.status).toBe(201);
  return res.body.id as string;
};

const orchestratorUrl = (projectId: string, action: string) =>
  `${PROJECTS}/${projectId}/orchestrator/${action}`;

describe("Orchestrator routes", () => {
  let app: Express;

  beforeAll(async () => {
    app = await getApp();
  });

  describe("GET /orchestrator/status", () => {
    it("returns stopped when no orchestrator session exists", async () => {
      const projectId = await createProject(app, "status-none");
      const res = await request(app).get(orchestratorUrl(projectId, "status"));

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("stopped");
      expect(res.body.project_id).toBe(projectId);
      expect(res.body.orchestrator_session_id).toBeNull();
      expect(res.body.session).toBeNull();
    });

    it("returns running status with session details when orchestrator is active", async () => {
      const projectId = await createProject(app, "status-running");

      // Start the orchestrator first
      const startRes = await request(app)
        .post(orchestratorUrl(projectId, "start"))
        .send({});
      expect(startRes.status).toBe(201);

      const res = await request(app).get(orchestratorUrl(projectId, "status"));

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("running");
      expect(res.body.orchestrator_session_id).toBe(startRes.body.id);
      expect(res.body.session).toBeDefined();
      expect(res.body.session.id).toBe(startRes.body.id);
      expect(res.body.session.status).toBe("running");
    });
  });

  describe("POST /orchestrator/start", () => {
    it("creates orchestrator session and returns 201", async () => {
      const projectId = await createProject(app, "start-create");

      const res = await request(app)
        .post(orchestratorUrl(projectId, "start"))
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe("running");
      expect(res.body.session_type).toBe("orchestrator");
      expect(res.body.project_id).toBe(projectId);
    });

    it("sets project orchestrator_session_id", async () => {
      const projectId = await createProject(app, "start-sets-id");

      const startRes = await request(app)
        .post(orchestratorUrl(projectId, "start"))
        .send({});
      expect(startRes.status).toBe(201);

      const projectRes = await request(app).get(`${PROJECTS}/${projectId}`);
      expect(projectRes.status).toBe(200);
      expect(projectRes.body.orchestrator_session_id).toBe(startRes.body.id);
    });

    it("is idempotent — returns same running session on repeat call", async () => {
      const projectId = await createProject(app, "start-idempotent");

      const first = await request(app)
        .post(orchestratorUrl(projectId, "start"))
        .send({});
      expect(first.status).toBe(201);

      const second = await request(app)
        .post(orchestratorUrl(projectId, "start"))
        .send({});

      // Second call returns 200 (existing session), same session id
      expect(second.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.status).toBe("running");
    });

    it("accepts optional context body", async () => {
      const projectId = await createProject(app, "start-context");
      const context = { goal: "deploy v2", priority: "high" };

      const res = await request(app)
        .post(orchestratorUrl(projectId, "start"))
        .send({ context });

      expect(res.status).toBe(201);
      expect(res.body.context).toEqual(context);
    });
  });

  describe("POST /orchestrator/stop", () => {
    it("stops running orchestrator and returns stopped status", async () => {
      const projectId = await createProject(app, "stop-running");

      // Start first
      expect(
        (await request(app).post(orchestratorUrl(projectId, "start")).send({}))
          .status,
      ).toBe(201);

      const res = await request(app)
        .post(orchestratorUrl(projectId, "stop"))
        .send();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "stopped" });
    });

    it("returns stopped even if no session exists (idempotent)", async () => {
      const projectId = await createProject(app, "stop-no-session");

      const res = await request(app)
        .post(orchestratorUrl(projectId, "stop"))
        .send();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "stopped" });
    });

    it("sets session status to stopped after stop", async () => {
      const projectId = await createProject(app, "stop-verify");

      expect(
        (await request(app).post(orchestratorUrl(projectId, "start")).send({}))
          .status,
      ).toBe(201);

      await request(app).post(orchestratorUrl(projectId, "stop")).send();

      // Verify via status endpoint that session is now stopped
      const statusRes = await request(app).get(
        orchestratorUrl(projectId, "status"),
      );
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.session.status).toBe("stopped");
      expect(statusRes.body.status).toBe("stopped");
    });
  });
});
