import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { getApp } from "./setup.js";

const API = "/api/v1";

const createProject = async (app: Express, name: string) => {
  const res = await request(app)
    .post(`${API}/projects`)
    .send({ name, repo_url: "https://github.com/test/repo" });
  expect(res.status).toBe(201);
  return res.body.id as string;
};

const knowledgeUrl = (projectId: string, knowledgeId?: string) =>
  knowledgeId
    ? `${API}/projects/${projectId}/knowledge/${knowledgeId}`
    : `${API}/projects/${projectId}/knowledge`;

describe("Knowledge API", () => {
  let app: Express;

  beforeAll(async () => {
    app = await getApp();
  });

  describe("GET /knowledge", () => {
    it("returns empty array when no entries exist", async () => {
      const projectId = await createProject(app, "knowledge-empty");
      const res = await request(app).get(knowledgeUrl(projectId));
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns all entries for the project", async () => {
      const projectId = await createProject(app, "knowledge-list");

      await request(app)
        .post(knowledgeUrl(projectId))
        .send({ title: "Entry 1", category: "guide", content: "Content 1" });
      await request(app)
        .post(knowledgeUrl(projectId))
        .send({ title: "Entry 2", category: "api", content: "Content 2" });

      const res = await request(app).get(knowledgeUrl(projectId));
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it("returns 404 for non-existent project", async () => {
      const res = await request(app).get(knowledgeUrl("non-existent-id"));
      expect(res.status).toBe(404);
    });
  });

  describe("GET /knowledge/:knowledgeId", () => {
    it("returns a single entry", async () => {
      const projectId = await createProject(app, "knowledge-get-one");
      const created = await request(app)
        .post(knowledgeUrl(projectId))
        .send({ title: "Single", category: "guide", content: "Details" });
      expect(created.status).toBe(201);

      const res = await request(app).get(
        knowledgeUrl(projectId, created.body.id),
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: created.body.id,
        title: "Single",
        category: "guide",
        content: "Details",
      });
    });

    it("returns 404 for non-existent entry", async () => {
      const projectId = await createProject(app, "knowledge-get-missing");
      const res = await request(app).get(
        knowledgeUrl(projectId, "non-existent-id"),
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 when entry belongs to another project", async () => {
      const projectA = await createProject(app, "knowledge-owner-a");
      const projectB = await createProject(app, "knowledge-owner-b");

      const created = await request(app)
        .post(knowledgeUrl(projectA))
        .send({ title: "Owned by A", category: "guide", content: "Content" });
      expect(created.status).toBe(201);

      const res = await request(app).get(
        knowledgeUrl(projectB, created.body.id),
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST /knowledge", () => {
    it("creates an entry with 201", async () => {
      const projectId = await createProject(app, "knowledge-create");
      const res = await request(app)
        .post(knowledgeUrl(projectId))
        .send({ title: "New Entry", category: "api", content: "API docs" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        title: "New Entry",
        category: "api",
        content: "API docs",
        project_id: projectId,
      });
      expect(res.body.id).toBeDefined();
      expect(res.body.created_at).toBeDefined();
    });

    it("creates an entry with optional fields", async () => {
      const projectId = await createProject(app, "knowledge-optional");
      const res = await request(app)
        .post(knowledgeUrl(projectId))
        .send({
          title: "With extras",
          category: "guide",
          content: "Full entry",
          source: "manual",
        });

      expect(res.status).toBe(201);
      expect(res.body.source).toBe("manual");
    });

    it("rejects missing required fields with 400", async () => {
      const projectId = await createProject(app, "knowledge-validate");

      const noTitle = await request(app)
        .post(knowledgeUrl(projectId))
        .send({ category: "api", content: "Content" });
      expect(noTitle.status).toBe(400);

      const noCategory = await request(app)
        .post(knowledgeUrl(projectId))
        .send({ title: "Title", content: "Content" });
      expect(noCategory.status).toBe(400);

      const noContent = await request(app)
        .post(knowledgeUrl(projectId))
        .send({ title: "Title", category: "api" });
      expect(noContent.status).toBe(400);
    });

    it("rejects empty strings with 400", async () => {
      const projectId = await createProject(app, "knowledge-empty-str");
      const res = await request(app)
        .post(knowledgeUrl(projectId))
        .send({ title: "", category: "api", content: "Content" });
      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent project", async () => {
      const res = await request(app)
        .post(knowledgeUrl("non-existent-id"))
        .send({ title: "Title", category: "api", content: "Content" });
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /knowledge/:knowledgeId", () => {
    it("updates title", async () => {
      const projectId = await createProject(app, "knowledge-patch-title");
      const created = await request(app)
        .post(knowledgeUrl(projectId))
        .send({ title: "Original", category: "guide", content: "Content" });

      const res = await request(app)
        .patch(knowledgeUrl(projectId, created.body.id))
        .send({ title: "Updated" });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Updated");
      expect(res.body.category).toBe("guide");
      expect(res.body.content).toBe("Content");
    });

    it("updates multiple fields at once", async () => {
      const projectId = await createProject(app, "knowledge-patch-multi");
      const created = await request(app)
        .post(knowledgeUrl(projectId))
        .send({ title: "Old", category: "guide", content: "Old content" });

      const res = await request(app)
        .patch(knowledgeUrl(projectId, created.body.id))
        .send({ title: "New", content: "New content", source: "scan" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        title: "New",
        content: "New content",
        source: "scan",
        category: "guide",
      });
    });

    it("returns 404 for non-existent entry", async () => {
      const projectId = await createProject(app, "knowledge-patch-missing");
      const res = await request(app)
        .patch(knowledgeUrl(projectId, "non-existent-id"))
        .send({ title: "Updated" });
      expect(res.status).toBe(404);
    });

    it("rejects empty string values with 400", async () => {
      const projectId = await createProject(app, "knowledge-patch-empty");
      const created = await request(app)
        .post(knowledgeUrl(projectId))
        .send({ title: "Valid", category: "guide", content: "Content" });

      const res = await request(app)
        .patch(knowledgeUrl(projectId, created.body.id))
        .send({ title: "" });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /knowledge/:knowledgeId", () => {
    it("deletes an entry with 204", async () => {
      const projectId = await createProject(app, "knowledge-delete");
      const created = await request(app)
        .post(knowledgeUrl(projectId))
        .send({ title: "To Delete", category: "guide", content: "Content" });
      expect(created.status).toBe(201);

      const del = await request(app).delete(
        knowledgeUrl(projectId, created.body.id),
      );
      expect(del.status).toBe(204);

      // Verify it's gone
      const get = await request(app).get(
        knowledgeUrl(projectId, created.body.id),
      );
      expect(get.status).toBe(404);
    });

    it("returns 404 for non-existent entry", async () => {
      const projectId = await createProject(app, "knowledge-delete-missing");
      const res = await request(app).delete(
        knowledgeUrl(projectId, "non-existent-id"),
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 when entry belongs to another project", async () => {
      const projectA = await createProject(app, "knowledge-del-owner-a");
      const projectB = await createProject(app, "knowledge-del-owner-b");

      const created = await request(app)
        .post(knowledgeUrl(projectA))
        .send({ title: "Owned by A", category: "guide", content: "Content" });

      const res = await request(app).delete(
        knowledgeUrl(projectB, created.body.id),
      );
      expect(res.status).toBe(404);
    });
  });
});
