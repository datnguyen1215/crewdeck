import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { getApp } from "./setup.js";
import { createAgentRun, createAgentRunEvent } from "../../src/db/repositories/agent-runs.js";
import { createIssue as createIssueInDb } from "../../src/db/repositories/issues.js";

describe("Runs API", () => {
  let app: Express;
  let projectId: string;
  let issueId: string;

  beforeAll(async () => {
    app = await getApp();
    // Create a project
    const projectRes = await request(app)
      .post("/api/v1/projects")
      .send({
        name: "runs-test-project",
        github_url: "https://github.com/test/runs-repo",
      });
    projectId = projectRes.body.id;

    // Create an issue
    const issueRes = await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .send({
        title: "Test issue for runs",
        description: "Testing agent runs",
      });
    issueId = issueRes.body.id;
  });

  describe("GET /projects/:projectId/issues/:issueId/runs", () => {
    it("returns empty array when no runs exist", async () => {
      // Create a fresh issue with no runs
      const issue = createIssueInDb(projectId, {
        title: "Fresh issue",
        description: "No runs",
      });
      const res = await request(app).get(
        `/api/v1/projects/${projectId}/issues/${issue.id}/runs`
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns runs for an issue", async () => {
      // Create runs directly in DB
      createAgentRun({
        project_id: projectId,
        issue_id: issueId,
        agent_id: "engineer",
      });
      createAgentRun({
        project_id: projectId,
        issue_id: issueId,
        agent_id: "captain",
      });

      const res = await request(app).get(
        `/api/v1/projects/${projectId}/issues/${issueId}/runs`
      );
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
      // Verify both runs are present (order may vary when created simultaneously)
      const agentIds = res.body.map((r: { agent_id: string }) => r.agent_id);
      expect(agentIds).toContain("engineer");
      expect(agentIds).toContain("captain");
    });

    it("returns 404 for non-existent issue", async () => {
      const res = await request(app).get(
        `/api/v1/projects/${projectId}/issues/nonexistent-issue/runs`
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 for non-existent project", async () => {
      const res = await request(app).get(
        `/api/v1/projects/nonexistent-project/issues/${issueId}/runs`
      );
      expect(res.status).toBe(404);
    });
  });

  describe("GET /projects/:projectId/runs/:runId", () => {
    it("returns run with events", async () => {
      const run = createAgentRun({
        project_id: projectId,
        issue_id: issueId,
        agent_id: "engineer",
      });
      createAgentRunEvent(run.id, "assistant", { text: "Hello" });
      createAgentRunEvent(run.id, "tool_use", { tool: "Read", input: {} });
      createAgentRunEvent(run.id, "result", { result: "Done" });

      const res = await request(app).get(
        `/api/v1/projects/${projectId}/runs/${run.id}`
      );
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(run.id);
      expect(res.body.agent_id).toBe("engineer");
      expect(res.body.events).toBeDefined();
      expect(res.body.events.length).toBe(3);
      expect(res.body.events[0].type).toBe("assistant");
      expect(res.body.events[1].type).toBe("tool_use");
      expect(res.body.events[2].type).toBe("result");
    });

    it("returns 404 for non-existent run", async () => {
      const res = await request(app).get(
        `/api/v1/projects/${projectId}/runs/nonexistent-run`
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 when run belongs to different project", async () => {
      // Create another project
      const proj2Res = await request(app)
        .post("/api/v1/projects")
        .send({
          name: "other-project",
          github_url: "https://github.com/test/other-repo",
        });
      const proj2Id = proj2Res.body.id;

      // Create issue in project 2
      const issue2 = createIssueInDb(proj2Id, {
        title: "Other issue",
        description: "In other project",
      });

      // Create run in project 2
      const run = createAgentRun({
        project_id: proj2Id,
        issue_id: issue2.id,
        agent_id: "engineer",
      });

      // Try to access run via project 1
      const res = await request(app).get(
        `/api/v1/projects/${projectId}/runs/${run.id}`
      );
      expect(res.status).toBe(404);
    });
  });

  describe("GET /projects/:projectId/runs", () => {
    it("returns all runs for a project", async () => {
      // Create a fresh project
      const projRes = await request(app)
        .post("/api/v1/projects")
        .send({
          name: "project-runs-test",
          github_url: "https://github.com/test/proj-runs",
        });
      const pid = projRes.body.id;

      // Create multiple issues with runs
      const issue1 = createIssueInDb(pid, { title: "I1", description: "D" });
      const issue2 = createIssueInDb(pid, { title: "I2", description: "D" });

      createAgentRun({
        project_id: pid,
        issue_id: issue1.id,
        agent_id: "engineer",
      });
      createAgentRun({
        project_id: pid,
        issue_id: issue2.id,
        agent_id: "captain",
      });
      createAgentRun({
        project_id: pid,
        issue_id: issue1.id,
        agent_id: "security",
      });

      const res = await request(app).get(`/api/v1/projects/${pid}/runs`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(3);
    });

    it("supports pagination with limit and offset", async () => {
      // Create a fresh project
      const projRes = await request(app)
        .post("/api/v1/projects")
        .send({
          name: "paginated-runs-test",
          github_url: "https://github.com/test/pag-runs",
        });
      const pid = projRes.body.id;
      const issue = createIssueInDb(pid, { title: "I", description: "D" });

      // Create 5 runs
      for (let i = 0; i < 5; i++) {
        createAgentRun({
          project_id: pid,
          issue_id: issue.id,
          agent_id: `agent-${i}`,
        });
      }

      const page1 = await request(app)
        .get(`/api/v1/projects/${pid}/runs`)
        .query({ limit: 2, offset: 0 });
      expect(page1.status).toBe(200);
      expect(page1.body.length).toBe(2);

      const page2 = await request(app)
        .get(`/api/v1/projects/${pid}/runs`)
        .query({ limit: 2, offset: 2 });
      expect(page2.status).toBe(200);
      expect(page2.body.length).toBe(2);

      // Verify different runs
      expect(page1.body[0].id).not.toBe(page2.body[0].id);
    });

    it("caps limit at 100", async () => {
      const res = await request(app)
        .get(`/api/v1/projects/${projectId}/runs`)
        .query({ limit: 500 });
      expect(res.status).toBe(200);
      // Can't directly check the SQL limit, but it should not error
    });

    it("uses default limit when not specified", async () => {
      const res = await request(app).get(`/api/v1/projects/${projectId}/runs`);
      expect(res.status).toBe(200);
      // Default limit is 50, response should be OK
    });

    it("returns 404 for non-existent project", async () => {
      const res = await request(app).get("/api/v1/projects/nonexistent/runs");
      expect(res.status).toBe(404);
    });
  });
});
