import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { getApp } from "./setup.js";
import { eventBus } from "../../src/events/bus.js";
import {
  createSession,
  getSession,
} from "../../src/db/repositories/sessions.js";

const BASE = "/api/v1/internal";
const FAKE_ID = "00000000-0000-0000-0000-000000000000";

let app: Express;
let projectId: string;
let agentId: string;
let issueId: string;
let sessionId: string;

beforeAll(async () => {
  app = await getApp();

  // Create project
  const projRes = await request(app)
    .post("/api/v1/projects")
    .send({ name: `internal-test-${Date.now()}` });
  expect(projRes.status).toBe(201);
  projectId = projRes.body.id;

  // Create agent
  const agentRes = await request(app)
    .post(`/api/v1/projects/${projectId}/crew/agents`)
    .send({ name: "Test Agent", role: "developer", system_prompt: "test" });
  expect(agentRes.status).toBe(201);
  agentId = agentRes.body.id;

  // Create issue
  const issueRes = await request(app)
    .post(`/api/v1/projects/${projectId}/issues`)
    .send({ title: "Test Issue", description: "for internal tests" });
  expect(issueRes.status).toBe(201);
  issueId = issueRes.body.id;

  // Create session directly via DB (no POST route exists)
  const session = createSession({
    project_id: projectId,
    session_type: "agent",
    agent_id: agentId,
    issue_id: issueId,
    status: "running",
  });
  sessionId = session.id;
});

describe("POST /api/v1/internal/signal", () => {
  it("work-complete emits agent.finished and returns 200", async () => {
    const handler = vi.fn();
    eventBus.on("agent.finished", handler);

    const res = await request(app).post(`${BASE}/signal`).send({
      session_id: sessionId,
      agent_id: agentId,
      issue_id: issueId,
      project_id: projectId,
      event: "work-complete",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: sessionId,
        agent_id: agentId,
        issue_id: issueId,
        project_id: projectId,
        role: "developer",
      }),
    );

    eventBus.off("agent.finished", handler);
  });

  it("review-complete with verdict emits review.completed", async () => {
    const handler = vi.fn();
    eventBus.on("review.completed", handler);

    const res = await request(app)
      .post(`${BASE}/signal`)
      .send({
        session_id: sessionId,
        agent_id: agentId,
        issue_id: issueId,
        project_id: projectId,
        event: "review-complete",
        data: { verdict: "approved" },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ verdict: "approved" }),
    );

    eventBus.off("review.completed", handler);
  });

  it("review-complete without verdict returns 400", async () => {
    const res = await request(app).post(`${BASE}/signal`).send({
      session_id: sessionId,
      agent_id: agentId,
      issue_id: issueId,
      project_id: projectId,
      event: "review-complete",
    });

    expect(res.status).toBe(400);
  });

  it("error signal emits agent.error", async () => {
    const handler = vi.fn();
    eventBus.on("agent.error", handler);

    const res = await request(app)
      .post(`${BASE}/signal`)
      .send({
        session_id: sessionId,
        agent_id: agentId,
        issue_id: issueId,
        project_id: projectId,
        event: "error",
        data: { message: "something broke" },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ message: "something broke" }),
    );

    eventBus.off("agent.error", handler);
  });

  it("needs-help signal emits agent.needs_help", async () => {
    const handler = vi.fn();
    eventBus.on("agent.needs_help", handler);

    const res = await request(app)
      .post(`${BASE}/signal`)
      .send({
        session_id: sessionId,
        agent_id: agentId,
        issue_id: issueId,
        project_id: projectId,
        event: "needs-help",
        data: { message: "stuck on tests" },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ message: "stuck on tests" }),
    );

    eventBus.off("agent.needs_help", handler);
  });

  it("returns 404 for non-existent agent", async () => {
    const res = await request(app).post(`${BASE}/signal`).send({
      session_id: sessionId,
      agent_id: FAKE_ID,
      issue_id: issueId,
      project_id: projectId,
      event: "work-complete",
    });

    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/internal/comment", () => {
  it("creates comment with author_type agent", async () => {
    const res = await request(app).post(`${BASE}/comment`).send({
      issue_id: issueId,
      project_id: projectId,
      agent_id: agentId,
      content: "Agent comment here",
    });

    expect(res.status).toBe(201);
    expect(res.body.author_type).toBe("agent");
    expect(res.body.content).toBe("Agent comment here");
    expect(res.body.author_id).toBe(agentId);
  });

  it("validates issue exists and belongs to project", async () => {
    const res = await request(app).post(`${BASE}/comment`).send({
      issue_id: FAKE_ID,
      project_id: projectId,
      content: "should fail",
    });

    expect(res.status).toBe(404);
  });

  it("rejects empty content with 400", async () => {
    const res = await request(app).post(`${BASE}/comment`).send({
      issue_id: issueId,
      project_id: projectId,
      content: "",
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/internal/status", () => {
  it("updates agent status and emits event", async () => {
    const handler = vi.fn();
    eventBus.on("agent.status_changed", handler);

    const res = await request(app).post(`${BASE}/status`).send({
      agent_id: agentId,
      issue_id: issueId,
      project_id: projectId,
      state: "active",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: agentId,
        state: "active",
      }),
    );

    eventBus.off("agent.status_changed", handler);
  });

  it("returns 404 for non-existent agent", async () => {
    const res = await request(app).post(`${BASE}/status`).send({
      agent_id: FAKE_ID,
      issue_id: issueId,
      project_id: projectId,
      state: "active",
    });

    expect(res.status).toBe(404);
  });

  it("validates required fields", async () => {
    const res = await request(app)
      .post(`${BASE}/status`)
      .send({ agent_id: agentId });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/internal/files", () => {
  let filesSessionId: string;

  beforeEach(() => {
    const session = createSession({
      project_id: projectId,
      session_type: "agent",
      agent_id: agentId,
      issue_id: issueId,
      status: "running",
    });
    filesSessionId = session.id;
  });

  it("sets modified files in session context", async () => {
    const res = await request(app)
      .post(`${BASE}/files`)
      .send({
        session_id: filesSessionId,
        modified: ["src/index.ts", "src/app.ts"],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Verify the session was updated in the DB
    const session = getSession(filesSessionId);
    expect(session).not.toBeNull();
    const ctx = session!.context as Record<string, unknown>;
    expect(ctx.modified_files).toEqual(["src/index.ts", "src/app.ts"]);
  });

  it("returns 404 for non-existent session", async () => {
    const res = await request(app)
      .post(`${BASE}/files`)
      .send({
        session_id: FAKE_ID,
        modified: ["file.ts"],
      });

    expect(res.status).toBe(404);
  });

  it("rejects empty array with 400", async () => {
    const res = await request(app).post(`${BASE}/files`).send({
      session_id: filesSessionId,
      modified: [],
    });

    expect(res.status).toBe(400);
  });

  it("rejects array exceeding 500 items with 400", async () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => `file-${i}.ts`);
    const res = await request(app).post(`${BASE}/files`).send({
      session_id: filesSessionId,
      modified: tooMany,
    });

    expect(res.status).toBe(400);
  });

  it("rejects paths exceeding 500 chars with 400", async () => {
    const longPath = "a".repeat(501);
    const res = await request(app)
      .post(`${BASE}/files`)
      .send({
        session_id: filesSessionId,
        modified: [longPath],
      });

    expect(res.status).toBe(400);
  });
});
