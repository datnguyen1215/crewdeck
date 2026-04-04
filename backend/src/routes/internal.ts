import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireScope } from "../middleware/scope.js";
import { createOwnershipVerifier } from "../middleware/ownership.js";
import { createComment } from "../db/repositories/comments.js";
import { createIssue, getIssue } from "../db/repositories/issues.js";
import { Scope } from "../constants/scopes.js";
import {
  createIssuePR,
  getIssuePRByRepoAndNumber,
} from "../db/repositories/issue-prs.js";
import { PRStatus } from "../constants/statuses.js";
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
import {
  handleMergePR,
  handleDispatchAgent,
  handleScanCodebase,
} from "../orchestration/command-handlers.js";

const router = Router();

const verifyIssueOwner = createOwnershipVerifier(
  getIssue,
  "Issue",
  "project_id",
);
const verifyKnowledgeOwner = createOwnershipVerifier(
  getKnowledge,
  "Knowledge entry",
  "project_id",
);

function verifyProjectExists(projectId: string) {
  const project = getProject(projectId);
  if (!project) throw new NotFoundError("Project not found");
  return project;
}

// Reuse base schemas with internal route requirements (project_id, issue_id, etc.)
const InternalCommentSchema = CreateCommentSchema.pick({
  content: true,
}).extend({
  issue_id: z.string(),
  project_id: z.string(),
  agent_id: z.string().optional(),
});

// POST /comment — agent posts a comment on an issue
router.post("/comment", requireScope(Scope.INTERNAL_COMMENT), validate(InternalCommentSchema), (req, res) => {
  const { issue_id, project_id, agent_id, content } = req.body;

  verifyIssueOwner(issue_id, project_id);

  // Use agent_id as author_type directly (e.g., "captain", "engineer")
  // Default to "captain" since only the captain uses this endpoint
  const comment = createComment(issue_id, {
    content,
    author_type: agent_id ?? "captain",
  });

  eventBus.emit("comment.added", { comment, project_id });
  res.status(201).json(comment);
});

// POST /issues/create — agent creates a new issue
const InternalCreateIssueSchema = BaseCreateIssueSchema.omit({
  created_by: true,
}).extend({
  project_id: z.string(),
  base_branch: z.string().min(1).optional(),
});

router.post(
  "/issues/create",
  requireScope(Scope.INTERNAL_CREATE_ISSUE),
  validate(InternalCreateIssueSchema),
  (req, res) => {
    const { project_id, title, description, base_branch } = req.body;
    const project = getProject(project_id);
    if (!project) throw new NotFoundError("Project not found");
    const resolvedBaseBranch =
      base_branch || project.default_base_branch || "main";
    const issue = createIssue(project_id, {
      title,
      description,
      created_by: "agent",
      base_branch: resolvedBaseBranch,
    });
    eventBus.emit("issue.created", { issue });
    res.status(201).json(issue);
  },
);

// POST /create-pr — agent registers a PR for tracking
const CreatePRSchema = z.object({
  project_id: z.string(),
  issue_id: z.string(),
  pr_url: z.string().min(1),
});

router.post("/create-pr", requireScope(Scope.INTERNAL_CREATE_PR), validate(CreatePRSchema), (req, res) => {
  const { project_id, issue_id, pr_url } = req.body;

  verifyIssueOwner(issue_id, project_id);

  // Parse PR URL to extract owner/repo/number
  const parsed = parsePRUrls(pr_url);
  if (parsed.length === 0) throw new ValidationError("Invalid GitHub PR URL");

  const pr = parsed[0];

  // Find matching repo by owner/name
  const repos = listRepos(project_id);
  const repo = repos.find(
    (r) =>
      r.owner.toLowerCase() === pr.owner.toLowerCase() &&
      r.name.toLowerCase() === pr.name.toLowerCase(),
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
    status: PRStatus.OPEN,
  });

  eventBus.emit("pr.created", { issue_pr: issuePR, project_id });
  res.status(201).json(issuePR);
});

// Captain orchestration endpoints
router.post("/captain/merge-pr", requireScope(Scope.INTERNAL_MERGE), async (req, res, next) => {
  try {
    const { project_id, issue_id } = req.body;
    if (!project_id || !issue_id) {
      throw new ValidationError("project_id and issue_id required");
    }
    const result = await handleMergePR(project_id, { issue_id });
    if (!result.success) {
      throw new ValidationError(result.message);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/captain/dispatch-agent", requireScope(Scope.INTERNAL_DISPATCH), async (req, res, next) => {
  try {
    const { project_id, issue_id, agent_id, instructions } = req.body;
    if (!project_id || !issue_id || !agent_id) {
      throw new ValidationError("project_id, issue_id, and agent_id required");
    }
    const result = await handleDispatchAgent(project_id, {
      issue_id,
      agent_id,
      instructions,
    });
    if (!result.success) {
      throw new ValidationError(result.message);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/captain/scan-codebase", requireScope(Scope.INTERNAL_SCAN), async (req, res, next) => {
  try {
    const { project_id } = req.body;
    if (!project_id) {
      throw new ValidationError("project_id required");
    }
    const result = await handleScanCodebase(project_id);
    if (!result.success) {
      throw new ValidationError(result.message);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /knowledge/list — list knowledge entries
const InternalKnowledgeListSchema = z.object({
  project_id: z.string(),
});

router.get(
  "/knowledge/list",
  requireScope(Scope.INTERNAL_KNOWLEDGE_READ),
  validate(InternalKnowledgeListSchema, "query"),
  (req, res) => {
    const { project_id } = req.query as { project_id: string };
    verifyProjectExists(project_id);
    const entries = listKnowledge(project_id);
    res.json(entries);
  },
);

// POST /knowledge/create — create knowledge entry (force source to "librarian")
const InternalKnowledgeCreateSchema = CreateKnowledgeSchema.omit({
  source: true,
}).extend({
  project_id: z.string(),
});

router.post(
  "/knowledge/create",
  requireScope(Scope.INTERNAL_KNOWLEDGE_WRITE),
  validate(InternalKnowledgeCreateSchema),
  (req, res) => {
    const { project_id, ...input } = req.body;
    verifyProjectExists(project_id);
    const entry = createKnowledge(project_id, {
      ...input,
      source: "librarian",
    });
    res.status(201).json(entry);
  },
);

// POST /knowledge/update — update knowledge entry
const InternalKnowledgeUpdateSchema = UpdateKnowledgeSchema.omit({
  source: true,
}).extend({
  project_id: z.string(),
  knowledge_id: z.string(),
});

router.post(
  "/knowledge/update",
  requireScope(Scope.INTERNAL_KNOWLEDGE_WRITE),
  validate(InternalKnowledgeUpdateSchema),
  (req, res) => {
    const { project_id, knowledge_id, ...updates } = req.body;
    verifyProjectExists(project_id);
    verifyKnowledgeOwner(knowledge_id, project_id);
    const updated = updateKnowledge(knowledge_id, updates);
    res.json(updated);
  },
);

// POST /knowledge/delete — delete knowledge entry
const InternalKnowledgeDeleteSchema = z.object({
  project_id: z.string(),
  knowledge_id: z.string(),
});

router.post(
  "/knowledge/delete",
  requireScope(Scope.INTERNAL_KNOWLEDGE_WRITE),
  validate(InternalKnowledgeDeleteSchema),
  (req, res) => {
    const { project_id, knowledge_id } = req.body;
    verifyProjectExists(project_id);
    verifyKnowledgeOwner(knowledge_id, project_id);
    removeKnowledge(knowledge_id);
    res.status(204).send();
  },
);

// GET /knowledge/titles — list knowledge titles (lightweight, for agent discovery)
const InternalKnowledgeTitlesSchema = z.object({
  project_id: z.string(),
});

router.get(
  "/knowledge/titles",
  requireScope(Scope.INTERNAL_KNOWLEDGE_READ),
  validate(InternalKnowledgeTitlesSchema, "query"),
  (req, res) => {
    const { project_id } = req.query as { project_id: string };
    verifyProjectExists(project_id);
    const entries = listKnowledge(project_id);
    const titles = entries.map((e) => ({
      id: e.id,
      title: e.title,
      category: e.category,
    }));
    res.json(titles);
  },
);

// GET /knowledge/get — get full knowledge entry by ID (for agent deep-read)
const InternalKnowledgeGetSchema = z.object({
  project_id: z.string(),
  knowledge_id: z.string(),
});

router.get(
  "/knowledge/get",
  requireScope(Scope.INTERNAL_KNOWLEDGE_READ),
  validate(InternalKnowledgeGetSchema, "query"),
  (req, res) => {
    const { project_id, knowledge_id } = req.query as {
      project_id: string;
      knowledge_id: string;
    };
    verifyProjectExists(project_id);
    const entry = getKnowledge(knowledge_id);
    if (!entry || entry.project_id !== project_id) {
      throw new NotFoundError("Knowledge entry not found");
    }
    res.json(entry);
  },
);

export default router;
