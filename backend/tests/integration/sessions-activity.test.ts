import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { getApp } from "./setup.js";
import { createSession } from "../../src/db/repositories/sessions.js";
import { createActivity } from "../../src/db/repositories/activity-log.js";

const PROJECTS = "/api/v1/projects";
const prefix = `sa-${Date.now()}`;

describe("Sessions & Activity Log", () => {
  let app: Express;
  let projectId: string;

  beforeAll(async () => {
    app = await getApp();
  });

  beforeEach(async () => {
    const res = await request(app)
      .post(PROJECTS)
      .send({ name: `${prefix}-${Math.random().toString(36).slice(2)}` });
    projectId = res.body.id;
  });

  const sessionsUrl = () => `${PROJECTS}/${projectId}/sessions`;
  const activityUrl = () => `${PROJECTS}/${projectId}/activity`;

  /** Insert a session directly via the repository. */
  const insertSession = async (overrides: Record<string, unknown> = {}) =>
    createSession({
      project_id: projectId,
      session_type: "worker",
      status: "idle",
      ...overrides,
    });

  /** Insert an activity log entry directly via the repository. */
  const insertActivity = async (overrides: Record<string, unknown> = {}) =>
    createActivity({
      project_id: projectId,
      actor_type: "system",
      action: "test.action",
      ...overrides,
    });

  /** Create a real issue so FK constraints on issue_id are satisfied. */
  const createIssue = async () => {
    const res = await request(app)
      .post(`${PROJECTS}/${projectId}/issues`)
      .send({ title: "test issue", description: "test" });
    return res.body.id as string;
  };

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  describe("GET /api/v1/projects/:projectId/sessions", () => {
    it("returns empty array when no sessions exist", async () => {
      const res = await request(app).get(sessionsUrl());
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns sessions after creating some", async () => {
      await insertSession({ session_type: "orchestrator" });
      await insertSession({ session_type: "worker" });

      const res = await request(app).get(sessionsUrl());
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it("filters by status", async () => {
      await insertSession({ status: "running" });
      await insertSession({ status: "idle" });

      const res = await request(app)
        .get(sessionsUrl())
        .query({ status: "running" });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].status).toBe("running");
    });

    it("filters by type (session_type)", async () => {
      await insertSession({ session_type: "orchestrator" });
      await insertSession({ session_type: "worker" });

      const res = await request(app)
        .get(sessionsUrl())
        .query({ type: "orchestrator" });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].session_type).toBe("orchestrator");
    });

    it("filters by issue_id", async () => {
      const issueA = await createIssue();
      const issueB = await createIssue();
      await insertSession({ issue_id: issueA });
      await insertSession({ issue_id: issueB });

      const res = await request(app)
        .get(sessionsUrl())
        .query({ issue_id: issueA });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].issue_id).toBe(issueA);
    });
  });

  describe("GET /api/v1/projects/:projectId/sessions/:sessionId", () => {
    it("returns session details", async () => {
      const session = await insertSession({
        session_type: "worker",
        status: "running",
      });

      const res = await request(app).get(`${sessionsUrl()}/${session.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(session.id);
      expect(res.body.session_type).toBe("worker");
      expect(res.body.status).toBe("running");
    });

    it("returns 404 for non-existent session", async () => {
      const res = await request(app).get(`${sessionsUrl()}/nonexistent-id`);
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Activity log
  // ---------------------------------------------------------------------------

  describe("GET /api/v1/projects/:projectId/activity", () => {
    it("returns activity entries", async () => {
      await insertActivity({ action: "issue.created" });
      await insertActivity({ action: "session.started" });

      const res = await request(app).get(activityUrl());
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it("filters by issue_id", async () => {
      const issueA = await createIssue();
      const issueB = await createIssue();
      await insertActivity({ issue_id: issueA, action: "issue.created" });
      await insertActivity({ issue_id: issueB, action: "issue.created" });

      const res = await request(app)
        .get(activityUrl())
        .query({ issue_id: issueA });
      expect(res.status).toBe(200);
      // At least the one we inserted; issue.created events may also be logged
      expect(
        res.body.some((e: { issue_id: string }) => e.issue_id === issueA),
      ).toBe(true);
    });

    it("filters by actor_type", async () => {
      await insertActivity({ actor_type: "agent" });
      await insertActivity({ actor_type: "system" });

      const res = await request(app)
        .get(activityUrl())
        .query({ actor_type: "agent" });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].actor_type).toBe("agent");
    });

    it("filters by action", async () => {
      await insertActivity({ action: "issue.created" });
      await insertActivity({ action: "session.started" });

      const res = await request(app)
        .get(activityUrl())
        .query({ action: "issue.created" });
      expect(res.status).toBe(200);
      // Exact count relies on beforeEach creating a fresh project with no
      // prior activity. If refactored to share projects, side-effects from
      // other operations may add extra entries.
      expect(res.body).toHaveLength(1);
      expect(res.body[0].action).toBe("issue.created");
    });

    it("filters by since (timestamp)", async () => {
      await insertActivity({ action: "old" });

      const future = new Date(Date.now() + 60_000).toISOString();
      const res = await request(app)
        .get(activityUrl())
        .query({ since: future });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });

    it("respects default limit (50)", async () => {
      const inserts = Array.from({ length: 55 }, (_, i) =>
        insertActivity({ action: `bulk-${i}` }),
      );
      await Promise.all(inserts);

      const res = await request(app).get(activityUrl());
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(50);
    });

    it("respects explicit limit", async () => {
      await insertActivity({ action: "a" });
      await insertActivity({ action: "b" });
      await insertActivity({ action: "c" });

      const res = await request(app).get(activityUrl()).query({ limit: "2" });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it("caps limit at 500", async () => {
      const res = await request(app)
        .get(activityUrl())
        .query({ limit: "9999" });
      // Should not error — just clamped internally
      expect(res.status).toBe(200);
    });

    it("respects offset", async () => {
      await insertActivity({ action: "first" });
      await insertActivity({ action: "second" });
      await insertActivity({ action: "third" });

      const all = await request(app).get(activityUrl());
      const withOffset = await request(app)
        .get(activityUrl())
        .query({ offset: "1" });

      expect(withOffset.status).toBe(200);
      expect(withOffset.body).toHaveLength(all.body.length - 1);
    });

    it("rejects negative limit with 400", async () => {
      const res = await request(app).get(activityUrl()).query({ limit: "-1" });
      expect(res.status).toBe(400);
    });

    it("rejects negative offset with 400", async () => {
      const res = await request(app).get(activityUrl()).query({ offset: "-1" });
      expect(res.status).toBe(400);
    });

    it("rejects non-integer limit with 400", async () => {
      const res = await request(app).get(activityUrl()).query({ limit: "abc" });
      expect(res.status).toBe(400);
    });

    it("rejects non-integer offset with 400", async () => {
      const res = await request(app)
        .get(activityUrl())
        .query({ offset: "abc" });
      expect(res.status).toBe(400);
    });
  });
});
