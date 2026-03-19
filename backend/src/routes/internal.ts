import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { createComment } from "../db/repositories/comments.js";
import { createIssue, getIssue, updateIssue } from "../db/repositories/issues.js";
import { NotFoundError } from "../middleware/errors.js";
import { eventBus } from "../events/bus.js";

const router = Router();

const CommentSchema = z.object({
  issue_id: z.string(),
  project_id: z.string(),
  agent_id: z.string().optional(),
  content: z.string().min(1),
});

// POST /comment — agent posts a comment on an issue
router.post("/comment", validate(CommentSchema), (req, res) => {
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

export default router;
