// TODO: add auth middleware — these endpoints are callable by any network-reachable client
import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { createComment } from "../db/repositories/comments.js";
import { getIssue } from "../db/repositories/issues.js";
import { getAgent } from "../db/repositories/agents.js";
import { getSession, updateSession } from "../db/repositories/sessions.js";
import { NotFoundError } from "../middleware/errors.js";
import { eventBus } from "../events/bus.js";

const router = Router();

const SignalSchema = z.object({
  session_id: z.string(),
  agent_id: z.string(),
  issue_id: z.string(),
  project_id: z.string(),
  event: z.enum(["work-complete", "review-complete", "error", "needs-help"]),
  data: z.object({ verdict: z.string().optional(), message: z.string().optional() }).optional(),
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
  state: z.enum(["active", "done", "error"]),
});

const FilesSchema = z.object({
  session_id: z.string(),
  modified: z.array(z.string()).min(1),
});

// POST /signal — receive agent completion signals
router.post("/signal", validate(SignalSchema), (req, res) => {
  const { session_id, agent_id, issue_id, project_id, event, data } = req.body;

  if (event === "work-complete") {
    // Look up the agent's role so the orchestrator can route correctly
    const agent = getAgent(agent_id);
    if (!agent) throw new NotFoundError("Agent not found");
    eventBus.emit("agent.finished", { session_id, agent_id, issue_id, project_id, role: agent.role });
  } else if (event === "review-complete") {
    const verdict = data?.verdict ?? "pending";
    eventBus.emit("review.completed", { session_id, issue_id, agent_id, project_id, verdict });
  } else if (event === "error") {
    const message = data?.message;
    eventBus.emit("agent.error", { session_id, agent_id, issue_id, project_id, message });
  } else {
    // Exhaustive check — Zod validates the event enum, so this always matches
    const message = data?.message;
    eventBus.emit("agent.needs_help", { session_id, agent_id, issue_id, project_id, message });
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
  const { agent_id, issue_id, project_id, state } = req.body;

  const agent = getAgent(agent_id);
  if (!agent) throw new NotFoundError("Agent not found");

  eventBus.emit("agent.status_changed", { agent_id, issue_id, project_id, state });

  res.json({ ok: true });
});

// POST /files — agent reports which files were modified during the session
// File paths are stored as metadata only — never used for filesystem access
router.post("/files", validate(FilesSchema), (req, res) => {
  const { session_id, modified } = req.body;

  const session = getSession(session_id);
  if (!session) throw new NotFoundError("Session not found");

  const ctx = session.context;
  // Guard needed because session.context is typed as unknown in the DB layer
  const existing = (typeof ctx === "object" && ctx !== null && !Array.isArray(ctx))
    ? (ctx as Record<string, unknown>)
    : {};
  updateSession(session_id, {
    context: { ...existing, modified_files: modified },
  });

  res.json({ ok: true });
});

export default router;
