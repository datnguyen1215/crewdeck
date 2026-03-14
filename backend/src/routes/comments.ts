import { Router, type Request } from "express";
import { listComments, createComment } from "../db/repositories/comments.js";
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

export default router;
