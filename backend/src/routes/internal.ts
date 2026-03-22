import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { createOwnershipVerifier } from "../middleware/ownership.js";
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

// Routes are intentionally unauthenticated — server is localhost-only. Add auth if deployment model changes.
const router = Router();

const verifyIssueOwner = createOwnershipVerifier(getIssue, "Issue", "project_id");
const verifyKnowledgeOwner = createOwnershipVerifier(getKnowledge, "Knowledge entry", "project_id");

function verifyProjectExists(projectId: string) {
  const project = getProject(projectId);
  if (!project) throw new NotFoundError("Project not found");
  return project;
}

const CommentSchema = z.object({
  issue_id: z.string(),
  project_id: z.string(),
  agent_id: z.string().optional(),
  content: z.string().min(1),
});

// POST /comment — agent posts a comment on an issue
router.post("/comment", validate(CommentSchema), (req, res) => {
  const { issue_id, project_id, agent_id, content } = req.body;

  verifyIssueOwner(issue_id, project_id);

  const comment = createComment(issue_id, {
    content,
    author_type: "agent",
    author_id: agent_id ?? null,
  });

  eventBus.emit("comment.added", { comment, project_id });
  res.status(201).json(comment);
});

// POST /issues/create — agent creates a new issue
const CreateIssueSchema = z.object({
  project_id: z.string(),
  title: z.string().min(1),
  description: z.string().min(1),
  priority: z.number().int().optional(),
});

router.post("/issues/create", validate(CreateIssueSchema), (req, res) => {
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
const IssueUpdateSchema = z.object({
  project_id: z.string(),
  issue_id: z.string(),
  priority: z.number().int(),
});

router.post("/issues/update", validate(IssueUpdateSchema), (req, res) => {
  const { project_id, issue_id, priority } = req.body;

  verifyIssueOwner(issue_id, project_id);

  const updated = updateIssue(issue_id, { priority });
  eventBus.emit("issue.updated", {
    issue_id,
    project_id,
    changes: { priority },
  });
  res.json(updated);
});

// GET /knowledge/list — list knowledge entries
const KnowledgeListSchema = z.object({
  project_id: z.string(),
});

router.get("/knowledge/list", validate(KnowledgeListSchema, "query"), (req, res) => {
  const { project_id } = req.query as { project_id: string };
  verifyProjectExists(project_id);
  const entries = listKnowledge(project_id);
  res.json(entries);
});

// POST /knowledge/create — create knowledge entry (force source to "librarian")
const KnowledgeCreateSchema = z.object({
  project_id: z.string(),
  title: z.string().min(1),
  category: z.string().min(1),
  content: z.string().min(1),
  agent_ids: z.array(z.string()).nullable().optional(),
});

router.post("/knowledge/create", validate(KnowledgeCreateSchema), (req, res) => {
  const { project_id, ...input } = req.body;
  verifyProjectExists(project_id);
  const entry = createKnowledge(project_id, { ...input, source: "librarian" });
  res.status(201).json(entry);
});

// POST /knowledge/update — update knowledge entry
const KnowledgeUpdateSchema = z.object({
  project_id: z.string(),
  knowledge_id: z.string(),
  title: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  agent_ids: z.array(z.string()).nullable().optional(),
});

router.post("/knowledge/update", validate(KnowledgeUpdateSchema), (req, res) => {
  const { project_id, knowledge_id, ...updates } = req.body;
  verifyProjectExists(project_id);
  verifyKnowledgeOwner(knowledge_id, project_id);
  const updated = updateKnowledge(knowledge_id, updates);
  res.json(updated);
});

// POST /knowledge/delete — delete knowledge entry
const KnowledgeDeleteSchema = z.object({
  project_id: z.string(),
  knowledge_id: z.string(),
});

router.post("/knowledge/delete", validate(KnowledgeDeleteSchema), (req, res) => {
  const { project_id, knowledge_id } = req.body;
  verifyProjectExists(project_id);
  verifyKnowledgeOwner(knowledge_id, project_id);
  removeKnowledge(knowledge_id);
  res.status(204).send();
});

export default router;
