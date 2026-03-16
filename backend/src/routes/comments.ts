import { Router, type Request } from "express";
import { listComments, createComment, getComment, updateComment, deleteComment } from "../db/repositories/comments.js";
import { getIssue } from "../db/repositories/issues.js";
import { validate } from "../middleware/validate.js";
import { NotFoundError } from "../middleware/errors.js";
import { CreateCommentSchema } from "../schemas/validation.js";
import { eventBus } from "../events/bus.js";

const router = Router({ mergeParams: true });

router.get("/", (req: Request<{ projectId: string; issueId: string }>, res) => {
  const issue = getIssue(req.params.issueId);
  if (!issue || issue.project_id !== req.params.projectId) {
    throw new NotFoundError("Issue not found");
  }
  res.json(listComments(req.params.issueId));
});

router.post("/", validate(CreateCommentSchema), (req: Request<{ projectId: string; issueId: string }>, res) => {
  const issue = getIssue(req.params.issueId);
  if (!issue || issue.project_id !== req.params.projectId) {
    throw new NotFoundError("Issue not found");
  }
  // Force author_type = "user" for user-facing comment endpoint
  const comment = createComment(req.params.issueId, { ...req.body, author_type: "user" });
  eventBus.emit("comment.added", { comment, project_id: issue.project_id });
  res.status(201).json(comment);
});

router.patch("/:commentId", (req: Request<{ projectId: string; issueId: string; commentId: string }>, res) => {
  const issue = getIssue(req.params.issueId);
  if (!issue || issue.project_id !== req.params.projectId) {
    throw new NotFoundError("Issue not found");
  }
  const existing = getComment(req.params.commentId);
  if (!existing || existing.issue_id !== req.params.issueId) {
    throw new NotFoundError("Comment not found");
  }
  if (existing.author_type !== "user") {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "Can only edit user comments" } });
    return;
  }
  const { content } = req.body;
  if (!content || typeof content !== "string" || !content.trim()) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Content is required" } });
    return;
  }
  const updated = updateComment(req.params.commentId, content);
  eventBus.emit("comment.updated", { comment: updated!, project_id: issue.project_id });
  res.json(updated);
});

router.delete("/:commentId", (req: Request<{ projectId: string; issueId: string; commentId: string }>, res) => {
  const issue = getIssue(req.params.issueId);
  if (!issue || issue.project_id !== req.params.projectId) {
    throw new NotFoundError("Issue not found");
  }
  const existing = getComment(req.params.commentId);
  if (!existing || existing.issue_id !== req.params.issueId) {
    throw new NotFoundError("Comment not found");
  }
  if (existing.author_type !== "user") {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "Can only delete user comments" } });
    return;
  }
  deleteComment(req.params.commentId);
  eventBus.emit("comment.deleted", { comment_id: req.params.commentId, issue_id: req.params.issueId, project_id: issue.project_id });
  res.status(204).end();
});

export default router;
