import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { getApp } from "./setup.js";

const API = "/api/v1";

/** Creates a project and an issue, returning their IDs. */
const seedProjectAndIssue = async (app: Express) => {
  const proj = await request(app)
    .post(`${API}/projects`)
    .send({ name: "comment-test-project" });
  expect(proj.status).toBe(201);
  const projectId = proj.body.id;

  const issue = await request(app)
    .post(`${API}/projects/${projectId}/issues`)
    .send({ title: "test issue", description: "for comment tests" });
  expect(issue.status).toBe(201);
  const issueId = issue.body.id;

  return { projectId, issueId };
};

const commentsUrl = (projectId: string, issueId: string) =>
  `${API}/projects/${projectId}/issues/${issueId}/comments`;

describe("Comments API", () => {
  let app: Express;

  beforeAll(async () => {
    app = await getApp();
  });

  describe("GET /comments", () => {
    it("returns empty array when no comments", async () => {
      const { projectId, issueId } = await seedProjectAndIssue(app);

      const res = await request(app).get(commentsUrl(projectId, issueId));
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns comments after adding some", async () => {
      const { projectId, issueId } = await seedProjectAndIssue(app);

      const c1 = await request(app)
        .post(commentsUrl(projectId, issueId))
        .send({ content: "first comment" });
      expect(c1.status).toBe(201);
      const c2 = await request(app)
        .post(commentsUrl(projectId, issueId))
        .send({ content: "second comment" });
      expect(c2.status).toBe(201);

      const res = await request(app).get(commentsUrl(projectId, issueId));
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      const contents = res.body.map((c: { content: string }) => c.content);
      expect(contents).toContain("first comment");
      expect(contents).toContain("second comment");
    });

    it("returns 404 for non-existent issue", async () => {
      const proj = await request(app)
        .post(`${API}/projects`)
        .send({ name: "no-issue-project" });
      expect(proj.status).toBe(201);

      const res = await request(app).get(
        commentsUrl(proj.body.id, "non-existent-issue-id"),
      );
      expect(res.status).toBe(404);
    });

    it("validates issue belongs to project", async () => {
      const { issueId } = await seedProjectAndIssue(app);

      // Create a second project — the issue doesn't belong to it
      const otherProj = await request(app)
        .post(`${API}/projects`)
        .send({ name: "other-project" });
      expect(otherProj.status).toBe(201);

      const res = await request(app).get(
        commentsUrl(otherProj.body.id, issueId),
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST /comments", () => {
    it("creates comment with 201 and forces author_type to user", async () => {
      const { projectId, issueId } = await seedProjectAndIssue(app);

      const res = await request(app)
        .post(commentsUrl(projectId, issueId))
        .send({ content: "hello", author_type: "agent" });

      expect(res.status).toBe(201);
      expect(res.body.author_type).toBe("user");
    });

    it("returns comment with id, content, author_type, and timestamps", async () => {
      const { projectId, issueId } = await seedProjectAndIssue(app);

      const res = await request(app)
        .post(commentsUrl(projectId, issueId))
        .send({ content: "detailed comment" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        content: "detailed comment",
        author_type: "user",
        issue_id: issueId,
      });
      expect(res.body.id).toBeDefined();
      expect(res.body.created_at).toBeDefined();
    });

    it("rejects empty content with 400", async () => {
      const { projectId, issueId } = await seedProjectAndIssue(app);

      const res = await request(app)
        .post(commentsUrl(projectId, issueId))
        .send({ content: "" });

      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent issue", async () => {
      const proj = await request(app)
        .post(`${API}/projects`)
        .send({ name: "post-no-issue" });
      expect(proj.status).toBe(201);

      const res = await request(app)
        .post(commentsUrl(proj.body.id, "fake-issue-id"))
        .send({ content: "orphan comment" });

      expect(res.status).toBe(404);
    });
  });
});
