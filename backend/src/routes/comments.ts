import { Router, type Request } from "express";
import { listComments, createComment, updateComment, deleteComment } from "../db/repositories/comments.js";
import { validate } from "../middleware/validate.js";
import { requireScope } from "../middleware/scope.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../middleware/errors.js";
import { verifyIssueOwnership, verifyCommentOwnership } from "../middleware/ownership.js";
import { CreateCommentSchema } from "../schemas/validation.js";
import { eventBus } from "../events/bus.js";
import { Scope } from "../constants/scopes.js";

const router = Router({ mergeParams: true });

router.get("/", requireScope(Scope.COMMENTS_READ), verifyIssueOwnership, (req: Request<{ projectId: string; issueId: string }>, res) => {
  res.json(listComments(req.params.issueId, Infinity));
});

router.post("/", requireScope(Scope.COMMENTS_CREATE), verifyIssueOwnership, validate(CreateCommentSchema), (req: Request<{ projectId: string; issueId: string }>, res) => {
  const issue = req.issue!;
  // Force author_type = "user" for user-facing comment endpoint
  const comment = createComment(req.params.issueId, { ...req.body, author_type: "user" });
  eventBus.emit("comment.added", { comment, project_id: issue.project_id });
  res.status(201).json(comment);
});

// Decision: no per-user ownership check on edit/delete — the app has no auth system yet,
// so there is no "current user" to verify against. All user-facing endpoints share this
// limitation. Add ownership checks here once authentication is implemented.
router.patch("/:commentId", requireScope(Scope.COMMENTS_EDIT), verifyIssueOwnership, verifyCommentOwnership, (req: Request<{ projectId: string; issueId: string; commentId: string }>, res) => {
  const issue = req.issue!;
  const existing = req.comment!;
  if (existing.author_type !== "user") {
    throw new ForbiddenError("Can only edit user comments");
  }
  const { content } = req.body;
  if (!content || typeof content !== "string" || !content.trim()) {
    throw new ValidationError("Content is required");
  }
  const updated = updateComment(req.params.commentId, content);
  if (!updated) {
    throw new NotFoundError("Comment not found");
  }
  eventBus.emit("comment.updated", { comment: updated, project_id: issue.project_id });
  res.json(updated);
});

router.delete("/:commentId", requireScope(Scope.COMMENTS_DELETE), verifyIssueOwnership, verifyCommentOwnership, (req: Request<{ projectId: string; issueId: string; commentId: string }>, res) => {
  const issue = req.issue!;
  const existing = req.comment!;
  if (existing.author_type !== "user") {
    throw new ForbiddenError("Can only delete user comments");
  }
  deleteComment(req.params.commentId);
  eventBus.emit("comment.deleted", { comment_id: req.params.commentId, issue_id: req.params.issueId, project_id: issue.project_id });
  res.status(204).end();
});

export default router;
