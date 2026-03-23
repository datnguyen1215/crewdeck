import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { createOwnershipVerifier } from "../middleware/ownership.js";
import { createComment } from "../db/repositories/comments.js";
import { createIssue, getIssue } from "../db/repositories/issues.js";
import {
  createIssuePR,
  getIssuePRByRepoAndNumber,
} from "../db/repositories/issue-prs.js";
import {
  listByProject as listKnowledge,
  getById as getKnowledge,
  create as createKnowledge,
  update as updateKnowledge,
  remove as removeKnowledge,
} from "../db/repositories/knowledge.js";
import { getProject } from "../db/repositories/projects.js";
import { listRepos } from "../db/repositories/repos.js";
import { NotFoundError, ValidationError } from "../middleware/errors.js";
import { eventBus } from "../events/bus.js";
import {
  CreateCommentSchema,
  CreateIssueSchema as BaseCreateIssueSchema,
  CreateKnowledgeSchema,
  UpdateKnowledgeSchema,
} from "../schemas/validation.js";
import { parsePRUrls } from "../pr/detector.js";

// Routes are intentionally unauthenticated — server is localhost-only. Add auth if deployment model changes.
const router = Router();

const verifyIssueOwner = createOwnershipVerifier(getIssue, "Issue", "project_id");
const verifyKnowledgeOwner = createOwnershipVerifier(getKnowledge, "Knowledge entry", "project_id");

function verifyProjectExists(projectId: string) {
  const project = getProject(projectId);
  if (!project) throw new NotFoundError("Project not found");
  return project;
}

// Reuse base schemas with internal route requirements (project_id, issue_id, etc.)
const InternalCommentSchema = CreateCommentSchema.pick({ content: true }).extend({
  issue_id: z.string(),
  project_id: z.string(),
  agent_id: z.string().optional(),
});

// POST /comment — agent posts a comment on an issue
router.post("/comment", validate(InternalCommentSchema), (req, res) => {
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
const InternalCreateIssueSchema = BaseCreateIssueSchema.omit({ created_by: true }).extend({
  project_id: z.string(),
});

router.post("/issues/create", validate(InternalCreateIssueSchema), (req, res) => {
  const { project_id, title, description } = req.body;
  const issue = createIssue(project_id, {
    title,
    description,
    created_by: "agent",
  });
  eventBus.emit("issue.created", { issue });
  res.status(201).json(issue);
});

// POST /create-pr — agent registers a PR for tracking
const CreatePRSchema = z.object({
  project_id: z.string(),
  issue_id: z.string(),
  pr_url: z.string().min(1),
});

router.post("/create-pr", validate(CreatePRSchema), (req, res) => {
  const { project_id, issue_id, pr_url } = req.body;

  verifyIssueOwner(issue_id, project_id);

  // Parse PR URL to extract owner/repo/number
  const parsed = parsePRUrls(pr_url);
  if (parsed.length === 0)
    throw new ValidationError("Invalid GitHub PR URL");

  const pr = parsed[0];

  // Find matching repo by owner/name
  const repos = listRepos(project_id);
  const repo = repos.find(
    (r) =>
      r.owner.toLowerCase() === pr.owner.toLowerCase() &&
      r.name.toLowerCase() === pr.name.toLowerCase()
  );

  if (!repo)
    throw new ValidationError("PR URL does not match any project repository");

  // Check if already linked
  const existing = getIssuePRByRepoAndNumber(repo.id, pr.prNumber);
  if (existing) {
    // Return existing record (idempotent)
    res.status(200).json(existing);
    return;
  }

  // Create IssuePR record
  const issuePR = createIssuePR({
    issue_id,
    repo_id: repo.id,
    pr_number: pr.prNumber,
    pr_url: pr.url,
    status: "open",
  });

  eventBus.emit("pr.created", { issue_pr: issuePR, project_id });
  res.status(201).json(issuePR);
});


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
  verifyKnowledgeOwner(knowledge_id, project_id);
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
  verifyKnowledgeOwner(knowledge_id, project_id);
  removeKnowledge(knowledge_id);
  res.status(204).send();
});

export default router;
