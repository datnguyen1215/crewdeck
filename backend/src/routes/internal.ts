import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { createComment } from "../db/repositories/comments.js";
import { getIssue, updateIssue } from "../db/repositories/issues.js";
import { getAgent } from "../db/repositories/agents.js";
import { NotFoundError } from "../middleware/errors.js";
import { eventBus } from "../events/bus.js";

const router = Router();

const SignalSchema = z.object({
  session_id: z.string(),
  agent_id: z.string(),
  issue_id: z.string(),
  project_id: z.string(),
  role: z.string(),
  signal: z.enum(["finished", "review_completed"]),
  verdict: z.string().optional(),
});

const CommentSchema = z.object({
  issue_id: z.string(),
  project_id: z.string(),
  agent_id: z.string().optional(),
  content: z.string().min(1),
});

const StatusSchema = z.object({
  agent_id: z.string(),
  issue_id: z.string(),
  project_id: z.string(),
  session_id: z.string(),
  state: z.string(),
});

const FilesSchema = z.object({
  issue_id: z.string(),
  agent_id: z.string(),
  project_id: z.string(),
  files: z.array(z.string()),
});

// POST /signal — receive agent completion signals
router.post("/signal", validate(SignalSchema), (req, res) => {
  const { session_id, agent_id, issue_id, project_id, role, signal, verdict } = req.body;

  if (signal === "finished") {
    eventBus.emit("agent.finished", { session_id, agent_id, issue_id, project_id, role });
  } else if (signal === "review_completed") {
    eventBus.emit("review.completed", {
      issue_id,
      agent_id,
      project_id,
      verdict: verdict ?? "approved",
    });
  }

  res.json({ ok: true });
});

// POST /comment — agent posts a comment on an issue
router.post("/comment", validate(CommentSchema), (req, res) => {
  const { issue_id, project_id, agent_id, content } = req.body;

  const issue = getIssue(issue_id);
  if (!issue || issue.project_id !== project_id) throw new NotFoundError("Issue not found");

  const comment = createComment(issue_id, {
    content,
    author_type: "agent",
    author_id: agent_id ?? null,
  });

  eventBus.emit("comment.added", { comment, project_id });
  res.status(201).json(comment);
});

// POST /status — agent updates its working status
router.post("/status", validate(StatusSchema), (req, res) => {
  const { agent_id, issue_id, project_id, session_id, state } = req.body;

  const agent = getAgent(agent_id);
  if (!agent) throw new NotFoundError("Agent not found");

  eventBus.emit("agent.status_changed", { agent_id, issue_id, project_id, state });

  if (state === "working") {
    eventBus.emit("agent.working", { agent_id, issue_id, project_id, session_id });
  } else if (state === "idle") {
    eventBus.emit("agent.idle", { agent_id, project_id });
  }

  res.json({ ok: true });
});

// POST /files — agent reports modified files
router.post("/files", validate(FilesSchema), (req, res) => {
  // Acknowledged — caller can subscribe to events if needed.
  // Currently just echoes back; the orchestrator layer will consume this via events if added.
  res.json({ ok: true, received: req.body.files.length });
});

export default router;
