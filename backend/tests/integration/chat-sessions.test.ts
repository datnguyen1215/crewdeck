import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { getApp } from "./setup.js";

const API = "/api/v1";

const createProject = async (app: Express, name: string) => {
  const res = await request(app)
    .post(`${API}/projects`)
    .send({ name, github_url: "https://github.com/test/repo" });
  expect(res.status).toBe(201);
  return res.body.id as string;
};

const sessionsUrl = (projectId: string) =>
  `${API}/projects/${projectId}/chat/sessions`;

const messagesUrl = (projectId: string, sessionId: string) =>
  `${API}/projects/${projectId}/chat/sessions/${sessionId}/messages`;

describe("Chat Sessions API", () => {
  let app: Express;

  beforeAll(async () => {
    app = await getApp();
  });

  describe("GET /chat/sessions", () => {
    it("returns empty array when no sessions exist", async () => {
      const projectId = await createProject(app, "chat-empty");
      const res = await request(app).get(sessionsUrl(projectId));
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns sessions for the project", async () => {
      const projectId = await createProject(app, "chat-list");

      await request(app)
        .post(sessionsUrl(projectId))
        .send({ title: "Session 1" });
      await request(app)
        .post(sessionsUrl(projectId))
        .send({ title: "Session 2" });

      const res = await request(app).get(sessionsUrl(projectId));
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it("returns 404 for non-existent project", async () => {
      const res = await request(app).get(sessionsUrl("non-existent-id"));
      expect(res.status).toBe(404);
    });
  });

  describe("POST /chat/sessions", () => {
    it("creates a session with 201", async () => {
      const projectId = await createProject(app, "chat-create");
      const res = await request(app)
        .post(sessionsUrl(projectId))
        .send({ title: "My Session" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        project_id: projectId,
        title: "My Session",
        status: "active",
      });
      expect(res.body.id).toBeDefined();
      expect(res.body.created_at).toBeDefined();
    });

    it("creates a session without a title", async () => {
      const projectId = await createProject(app, "chat-no-title");
      const res = await request(app).post(sessionsUrl(projectId)).send({});

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("active");
    });

    it("archives previous active session when creating new one", async () => {
      const projectId = await createProject(app, "chat-archive");

      const first = await request(app)
        .post(sessionsUrl(projectId))
        .send({ title: "First" });
      expect(first.status).toBe(201);
      expect(first.body.status).toBe("active");

      const second = await request(app)
        .post(sessionsUrl(projectId))
        .send({ title: "Second" });
      expect(second.status).toBe(201);
      expect(second.body.status).toBe("active");

      // List all sessions and verify first is archived
      const list = await request(app).get(sessionsUrl(projectId));
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(2);

      const firstSession = list.body.find(
        (s: { id: string }) => s.id === first.body.id,
      );
      const secondSession = list.body.find(
        (s: { id: string }) => s.id === second.body.id,
      );
      expect(firstSession.status).toBe("archived");
      expect(secondSession.status).toBe("active");
    });

    it("returns 404 for non-existent project", async () => {
      const res = await request(app)
        .post(sessionsUrl("non-existent-id"))
        .send({ title: "Orphan" });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /chat/sessions/:sessionId/messages", () => {
    it("returns empty array for session with no messages", async () => {
      const projectId = await createProject(app, "chat-messages-empty");
      const session = await request(app)
        .post(sessionsUrl(projectId))
        .send({ title: "Empty Session" });

      const res = await request(app).get(
        messagesUrl(projectId, session.body.id),
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns 404 for non-existent session", async () => {
      const projectId = await createProject(app, "chat-messages-missing");
      const res = await request(app).get(
        messagesUrl(projectId, "non-existent-id"),
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 when session belongs to another project", async () => {
      const projectA = await createProject(app, "chat-msg-owner-a");
      const projectB = await createProject(app, "chat-msg-owner-b");

      const session = await request(app)
        .post(sessionsUrl(projectA))
        .send({ title: "A's session" });

      const res = await request(app).get(
        messagesUrl(projectB, session.body.id),
      );
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /chat", () => {
    it("clears all chat history with 204", async () => {
      const projectId = await createProject(app, "chat-delete");

      // Create sessions
      await request(app)
        .post(sessionsUrl(projectId))
        .send({ title: "To Delete" });

      const del = await request(app).delete(
        `${API}/projects/${projectId}/chat`,
      );
      expect(del.status).toBe(204);
    });

    it("returns 404 for non-existent project", async () => {
      const res = await request(app).delete(
        `${API}/projects/non-existent-id/chat`,
      );
      expect(res.status).toBe(404);
    });
  });
});
