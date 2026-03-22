import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { createComment } from "../db/repositories/comments.js";
import { createIssue, getIssue, updateIssue } from "../db/repositories/issues.js";
import {
  listByProject as listKnowledge,
  getById as getKnowledge,
  create as createKnowledge,
  update as updateKnowledge,
  remove as removeKnowledge,
} from "../db/repositories/knowledge.js";
import { getProject } from "../db/repositories/projects.js";
import { NotFoundError } from "../middleware/errors.js";
import { eventBus } from "../events/bus.js";
import {
  CreateCommentSchema,
  CreateIssueSchema as BaseCreateIssueSchema,
  UpdateIssueSchema,
  CreateKnowledgeSchema,
  UpdateKnowledgeSchema,
} from "../schemas/validation.js";

// Routes are intentionally unauthenticated — server is localhost-only. Add auth if deployment model changes.
const router = Router();

// Reuse base schemas with internal route requirements (project_id, issue_id, etc.)
const InternalCommentSchema = CreateCommentSchema.pick({ content: true }).extend({
  issue_id: z.string(),
  project_id: z.string(),
  agent_id: z.string().optional(),
});

// POST /comment — agent posts a comment on an issue
router.post("/comment", validate(InternalCommentSchema), (req, res) => {
  const { issue_id, project_id, agent_id, content } = req.body;

  const issue = getIssue(issue_id);
  if (!issue || issue.project_id !== project_id)
    throw new NotFoundError("Issue not found");

  const comment = createComment(issue_id, {
    content,
    author_type: "agent",
    author_id: agent_id ?? null,
  });

  eventBus.emit("comment.added", { comment, project_id });
  res.status(201).json(comment);
});

// POST /issues/create — agent creates a new issue
const InternalCreateIssueSchema = BaseCreateIssueSchema.omit({ created_by: true }).extend({
  project_id: z.string(),
});

router.post("/issues/create", validate(InternalCreateIssueSchema), (req, res) => {
  const { project_id, title, description, priority } = req.body;
  const issue = createIssue(project_id, {
    title,
    description,
    priority,
    created_by: "agent",
  });
  eventBus.emit("issue.created", { issue });
  res.status(201).json(issue);
});

// POST /issues/update — update issue fields
const InternalIssueUpdateSchema = UpdateIssueSchema.pick({ priority: true }).required().extend({
  project_id: z.string(),
  issue_id: z.string(),
});

router.post("/issues/update", validate(InternalIssueUpdateSchema), (req, res) => {
  const { project_id, issue_id, priority } = req.body;

  const issue = getIssue(issue_id);
  if (!issue || issue.project_id !== project_id)
    throw new NotFoundError("Issue not found");

  const updated = updateIssue(issue_id, { priority });
  eventBus.emit("issue.updated", {
    issue_id,
    project_id,
    changes: { priority },
  });
  res.json(updated);
});

// Helper to verify project for internal routes
function verifyProjectExists(projectId: string) {
  const project = getProject(projectId);
  if (!project) throw new NotFoundError("Project not found");
  return project;
}

// GET /knowledge/list — list knowledge entries
const InternalKnowledgeListSchema = z.object({
  project_id: z.string(),
});

router.get("/knowledge/list", validate(InternalKnowledgeListSchema, "query"), (req, res) => {
  const { project_id } = req.query as { project_id: string };
  verifyProjectExists(project_id);
  const entries = listKnowledge(project_id);
  res.json(entries);
});

// POST /knowledge/create — create knowledge entry (force source to "librarian")
const InternalKnowledgeCreateSchema = CreateKnowledgeSchema.omit({ source: true }).extend({
  project_id: z.string(),
});

router.post("/knowledge/create", validate(InternalKnowledgeCreateSchema), (req, res) => {
  const { project_id, ...input } = req.body;
  verifyProjectExists(project_id);
  const entry = createKnowledge(project_id, { ...input, source: "librarian" });
  res.status(201).json(entry);
});

// POST /knowledge/update — update knowledge entry
const InternalKnowledgeUpdateSchema = UpdateKnowledgeSchema.omit({ source: true }).extend({
  project_id: z.string(),
  knowledge_id: z.string(),
});

router.post("/knowledge/update", validate(InternalKnowledgeUpdateSchema), (req, res) => {
  const { project_id, knowledge_id, ...updates } = req.body;
  verifyProjectExists(project_id);

  const existing = getKnowledge(knowledge_id);
  if (!existing || existing.project_id !== project_id) {
    throw new NotFoundError("Knowledge entry not found");
  }

  const updated = updateKnowledge(knowledge_id, updates);
  res.json(updated);
});

// POST /knowledge/delete — delete knowledge entry
const InternalKnowledgeDeleteSchema = z.object({
  project_id: z.string(),
  knowledge_id: z.string(),
});

router.post("/knowledge/delete", validate(InternalKnowledgeDeleteSchema), (req, res) => {
  const { project_id, knowledge_id } = req.body;
  verifyProjectExists(project_id);

  const existing = getKnowledge(knowledge_id);
  if (!existing || existing.project_id !== project_id) {
    throw new NotFoundError("Knowledge entry not found");
  }

  removeKnowledge(knowledge_id);
  res.status(204).send();
});

export default router;
