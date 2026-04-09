import { describe, it, expect, beforeAll, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { getApp } from "./setup.js";
import { createIssue as createIssueInDb } from "../../src/db/repositories/issues.js";
import { activeProcesses } from "../../src/orchestration/processes.js";

/** Transition an issue through a sequence of statuses via PATCH. */
const transitionTo = async (
  app: Express,
  projectId: string,
  issueId: string,
  statuses: string[],
) => {
  for (const status of statuses) {
    const res = await request(app)
      .patch(`/api/v1/projects/${projectId}/issues/${issueId}`)
      .send({ status });
    if (res.status !== 200) {
      throw new Error(
        `transitionTo failed: expected 200 for "${status}", got ${res.status}`,
      );
    }
  }
};

/** Create an issue via the API and return its body. */
const createIssue = async (
  app: Express,
  projectId: string,
  overrides: Record<string, unknown> = {},
) => {
  const res = await request(app)
    .post(`/api/v1/projects/${projectId}/issues`)
    .send({
      title: "Test issue",
      description: "Test description",
      ...overrides,
    });
  return res.body;
};

describe("Issues API", () => {
  let app: Express;
  let projectId: string;
  const base = (pid: string) => `/api/v1/projects/${pid}/issues`;

  beforeAll(async () => {
    app = await getApp();
    const res = await request(app)
      .post("/api/v1/projects")
      .send({
        name: "issues-test-project",
        repo_url: "https://github.com/test/repo",
      });
    projectId = res.body.id;
  });

  // --- CRUD ---

  describe("GET /issues", () => {
    it("returns empty array when no issues", async () => {
      const proj = await request(app)
        .post("/api/v1/projects")
        .send({
          name: "empty-project",
          repo_url: "https://github.com/test/repo",
        });
      const res = await request(app).get(base(proj.body.id));
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns all issues for a project", async () => {
      await createIssue(app, projectId, { title: "List test 1" });
      await createIssue(app, projectId, { title: "List test 2" });
      const res = await request(app).get(base(projectId));
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });

    it("filters by status (single value)", async () => {
      await createIssue(app, projectId, { title: "Filter single" });
      const res = await request(app)
        .get(base(projectId))
        .query({ status: "open" });
      expect(res.status).toBe(200);
      expect(
        res.body.every((i: { status: string }) => i.status === "open"),
      ).toBe(true);
    });

    it("filters by status (comma-separated)", async () => {
      const issue = await createIssue(app, projectId);
      await transitionTo(app, projectId, issue.id, ["in_progress"]);
      const res = await request(app)
        .get(base(projectId))
        .query({ status: "open,in_progress" });
      expect(res.status).toBe(200);
      res.body.forEach((i: { status: string }) => {
        expect(["open", "in_progress"]).toContain(i.status);
      });
    });

    it("filters by created_by", async () => {
      // Seed an issue with a different created_by directly in the DB
      createIssueInDb(projectId, {
        title: "Agent issue",
        description: "Created by agent",
        created_by: "agent",
      });
      await createIssue(app, projectId, { title: "User issue" });

      const res = await request(app)
        .get(base(projectId))
        .query({ created_by: "user" });
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      res.body.forEach((i: { created_by: string }) => {
        expect(i.created_by).toBe("user");
      });

      // Verify the agent issue exists but is excluded
      const allRes = await request(app).get(base(projectId));
      const agentIssues = allRes.body.filter(
        (i: { created_by: string }) => i.created_by === "agent",
      );
      expect(agentIssues.length).toBeGreaterThan(0);
    });

    it("sorts by created_at with order", async () => {
      const res = await request(app)
        .get(base(projectId))
        .query({ sort: "created_at", order: "asc" });
      expect(res.status).toBe(200);
      const dates = res.body.map((i: { created_at: string }) => i.created_at);
      expect(dates).toEqual([...dates].sort());
    });
  });

  describe("POST /issues", () => {
    it("creates issue with defaults", async () => {
      const res = await request(app)
        .post(base(projectId))
        .send({ title: "New issue", description: "Desc" });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("open");
      expect(res.body.created_by).toBe("user");
      expect(res.body.title).toBe("New issue");
    });

    it("validates required fields", async () => {
      const res = await request(app).post(base(projectId)).send({});
      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent project", async () => {
      const res = await request(app)
        .post(base("nonexistent-id"))
        .send({ title: "X", description: "Y" });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /issues/:issueId", () => {
    it("returns issue with full details", async () => {
      const issue = await createIssue(app, projectId, { title: "Detail test" });
      const res = await request(app).get(`${base(projectId)}/${issue.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(issue.id);
      expect(res.body.title).toBe("Detail test");
    });

    it("returns 404 for non-existent issue", async () => {
      const res = await request(app).get(`${base(projectId)}/nonexistent`);
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /issues/:issueId", () => {
    it("updates title and description", async () => {
      const issue = await createIssue(app, projectId, { title: "Old title" });
      const res = await request(app)
        .patch(`${base(projectId)}/${issue.id}`)
        .send({ title: "New title", description: "New desc" });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("New title");
      expect(res.body.description).toBe("New desc");
    });

    it("returns 404 for non-existent issue", async () => {
      const res = await request(app)
        .patch(`${base(projectId)}/nonexistent`)
        .send({ title: "X" });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /issues/:issueId", () => {
    it("deletes issue", async () => {
      const issue = await createIssue(app, projectId);
      const res = await request(app).delete(`${base(projectId)}/${issue.id}`);
      expect(res.status).toBe(204);
      const check = await request(app).get(`${base(projectId)}/${issue.id}`);
      expect(check.status).toBe(404);
    });

    it("returns 404 for non-existent issue", async () => {
      const res = await request(app).delete(`${base(projectId)}/nonexistent`);
      expect(res.status).toBe(404);
    });
  });

  // --- Status transitions (valid) ---
  // Allowed: open -> in_progress, in_progress -> pr_created, pr_created -> in_progress
  // Any status can transition to done.

  describe("status transitions - valid", () => {
    it("open -> in_progress", async () => {
      const issue = await createIssue(app, projectId);
      const res = await request(app)
        .patch(`${base(projectId)}/${issue.id}`)
        .send({ status: "in_progress" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("in_progress");
    });

    it("in_progress -> pr_created", async () => {
      const issue = await createIssue(app, projectId);
      await transitionTo(app, projectId, issue.id, ["in_progress"]);
      const res = await request(app)
        .patch(`${base(projectId)}/${issue.id}`)
        .send({ status: "pr_created" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("pr_created");
    });

    it("pr_created -> in_progress", async () => {
      const issue = await createIssue(app, projectId);
      await transitionTo(app, projectId, issue.id, ["in_progress", "pr_created"]);
      const res = await request(app)
        .patch(`${base(projectId)}/${issue.id}`)
        .send({ status: "in_progress" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("in_progress");
    });

    it("pr_created -> done", async () => {
      const issue = await createIssue(app, projectId);
      await transitionTo(app, projectId, issue.id, [
        "in_progress",
        "pr_created",
      ]);
      const res = await request(app)
        .patch(`${base(projectId)}/${issue.id}`)
        .send({ status: "done" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("done");
    });

    it("any status can transition to done (escape hatch)", async () => {
      const issue = await createIssue(app, projectId);
      const res = await request(app)
        .patch(`${base(projectId)}/${issue.id}`)
        .send({ status: "done" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("done");
    });
  });

  // --- Status transitions (invalid) ---

  describe("status transitions - invalid", () => {
    it("open -> pr_created is rejected", async () => {
      const issue = await createIssue(app, projectId);
      const res = await request(app)
        .patch(`${base(projectId)}/${issue.id}`)
        .send({ status: "pr_created" });
      expect(res.status).toBe(400);
    });

    it("done -> open is rejected (done is terminal)", async () => {
      const issue = await createIssue(app, projectId);
      await transitionTo(app, projectId, issue.id, ["done"]);
      const res = await request(app)
        .patch(`${base(projectId)}/${issue.id}`)
        .send({ status: "open" });
      expect(res.status).toBe(400);
    });
  });

  // --- PATCH consolidation (formerly action endpoints) ---

  describe("PATCH status idempotency", () => {
    it("returns issue unchanged when status already matches", async () => {
      const issue = await createIssue(app, projectId);
      await transitionTo(app, projectId, issue.id, ["done"]);
      const res = await request(app)
        .patch(`${base(projectId)}/${issue.id}`)
        .send({ status: "done" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("done");
    });
  });

  describe("PATCH chain_depth reset", () => {
    it("resets chain_depth to 0", async () => {
      const issue = await createIssue(app, projectId);
      const res = await request(app)
        .patch(`${base(projectId)}/${issue.id}`)
        .send({ chain_depth: 0 });
      expect(res.status).toBe(200);
      expect(res.body.chain_depth).toBe(0);
    });
  });

  // --- Dependencies ---

  describe("PUT /issues/:issueId/dependencies", () => {
    it("sets dependencies and returns summaries", async () => {
      const issueA = await createIssue(app, projectId, { title: "A" });
      const issueB = await createIssue(app, projectId, { title: "B" });
      const issueC = await createIssue(app, projectId, { title: "C" });

      const res = await request(app)
        .put(`${base(projectId)}/${issueA.id}/dependencies`)
        .send({ depends_on: [issueB.id, issueC.id] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.issue_id).toBe(issueA.id);
      expect(res.body.dependencies).toHaveLength(2);
      expect(res.body.dependencies.map((d: { id: string }) => d.id).sort()).toEqual(
        [issueB.id, issueC.id].sort(),
      );
    });

    it("atomically replaces existing dependencies", async () => {
      const issueA = await createIssue(app, projectId, { title: "A" });
      const issueB = await createIssue(app, projectId, { title: "B" });
      const issueC = await createIssue(app, projectId, { title: "C" });

      // Set initial dependency
      await request(app)
        .put(`${base(projectId)}/${issueA.id}/dependencies`)
        .send({ depends_on: [issueB.id] });

      // Replace with a different dependency
      const res = await request(app)
        .put(`${base(projectId)}/${issueA.id}/dependencies`)
        .send({ depends_on: [issueC.id] });

      expect(res.status).toBe(200);
      expect(res.body.dependencies).toHaveLength(1);
      expect(res.body.dependencies[0].id).toBe(issueC.id);
    });

    it("returns 400 for self-dependency", async () => {
      const issue = await createIssue(app, projectId, { title: "Self" });

      const res = await request(app)
        .put(`${base(projectId)}/${issue.id}/dependencies`)
        .send({ depends_on: [issue.id] });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("cannot depend on itself");
    });

    it("returns 400 for non-existent dependency ID", async () => {
      const issue = await createIssue(app, projectId, { title: "A" });

      const res = await request(app)
        .put(`${base(projectId)}/${issue.id}/dependencies`)
        .send({ depends_on: ["nonexistent-id"] });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("not found");
    });

    it("returns 400 for dependency in different project", async () => {
      const issueA = await createIssue(app, projectId, { title: "A" });

      // Create an issue in a different project
      const otherProj = await request(app)
        .post("/api/v1/projects")
        .send({ name: "other-project", repo_url: "https://github.com/test/repo2" });
      const issueB = await request(app)
        .post(base(otherProj.body.id))
        .send({ title: "B", description: "desc" });

      const res = await request(app)
        .put(`${base(projectId)}/${issueA.id}/dependencies`)
        .send({ depends_on: [issueB.body.id] });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("not in this project");
    });

    it("returns 400 for circular dependency", async () => {
      const issueA = await createIssue(app, projectId, { title: "A" });
      const issueB = await createIssue(app, projectId, { title: "B" });

      // A depends on B
      await request(app)
        .put(`${base(projectId)}/${issueA.id}/dependencies`)
        .send({ depends_on: [issueB.id] });

      // B depends on A → circular
      const res = await request(app)
        .put(`${base(projectId)}/${issueB.id}/dependencies`)
        .send({ depends_on: [issueA.id] });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("Circular dependency");
    });

    it("returns 200 with empty dependencies for empty depends_on array", async () => {
      const issue = await createIssue(app, projectId, { title: "A" });

      const res = await request(app)
        .put(`${base(projectId)}/${issue.id}/dependencies`)
        .send({ depends_on: [] });

      expect(res.status).toBe(200);
      expect(res.body.dependencies).toEqual([]);
    });

    it("returns 404 for non-existent issue", async () => {
      const res = await request(app)
        .put(`${base(projectId)}/nonexistent/dependencies`)
        .send({ depends_on: ["some-id"] });

      expect(res.status).toBe(404);
    });

    it("returns dependency summaries with title and status", async () => {
      const issueA = await createIssue(app, projectId, { title: "A" });
      const issueB = await createIssue(app, projectId, {
        title: "Feature B",
        description: "desc",
      });

      const res = await request(app)
        .put(`${base(projectId)}/${issueA.id}/dependencies`)
        .send({ depends_on: [issueB.id] });

      expect(res.status).toBe(200);
      const dep = res.body.dependencies[0];
      expect(dep.id).toBe(issueB.id);
      expect(dep.title).toBe("Feature B");
      expect(dep.status).toBe("open");
    });
  });

  describe("PATCH status=done with active processes", () => {
    afterEach(() => {
      for (const entry of activeProcesses.values()) {
        clearTimeout(entry.timer);
      }
      activeProcesses.clear();
    });

    it("blocks done when other agents are running", async () => {
      const issue = await createIssue(app, projectId);
      // Simulate an active process for a different agent
      activeProcesses.set(999, {
        pid: 999,
        process: {} as any,
        projectId,
        issueId: issue.id,
        agentId: "other-agent",
        agentRunId: "run-1",
        timer: setTimeout(() => {}, 0),
      });

      const res = await request(app)
        .patch(`${base(projectId)}/${issue.id}`)
        .set("X-Agent-ID", "captain")
        .send({ status: "done" });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain("agents are still running");
    });

    it("allows done when requesting agent is the only active process", async () => {
      const issue = await createIssue(app, projectId);
      // Simulate an active process for the requesting agent (captain)
      activeProcesses.set(999, {
        pid: 999,
        process: {} as any,
        projectId,
        issueId: issue.id,
        agentId: "captain",
        agentRunId: "run-1",
        timer: setTimeout(() => {}, 0),
      });

      const res = await request(app)
        .patch(`${base(projectId)}/${issue.id}`)
        .set("X-Agent-ID", "captain")
        .send({ status: "done" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("done");
    });

    it("blocks done when no X-Agent-ID header and processes are running", async () => {
      const issue = await createIssue(app, projectId);
      activeProcesses.set(999, {
        pid: 999,
        process: {} as any,
        projectId,
        issueId: issue.id,
        agentId: "captain",
        agentRunId: "run-1",
        timer: setTimeout(() => {}, 0),
      });

      const res = await request(app)
        .patch(`${base(projectId)}/${issue.id}`)
        .send({ status: "done" });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain("agents are still running");
    });
  });
});
