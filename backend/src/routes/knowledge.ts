import { Router, type Request } from "express";
import {
  listByProject,
  getById,
  create,
  update,
  remove,
} from "../db/repositories/knowledge.js";
import { createIssue } from "../db/repositories/issues.js";
import { createComment } from "../db/repositories/comments.js";
import { validate } from "../middleware/validate.js";
import { verifyProject } from "../middleware/ownership.js";
import { NotFoundError } from "../middleware/errors.js";
import {
  CreateKnowledgeSchema,
  UpdateKnowledgeSchema,
} from "../schemas/validation.js";
import { eventBus } from "../events/bus.js";

const router = Router({ mergeParams: true });

router.get("/", verifyProject, (req: Request<{ projectId: string }>, res) => {
  const entries = listByProject(req.params.projectId);
  res.json(entries);
});

router.get(
  "/:knowledgeId",
  verifyProject,
  (req: Request<{ projectId: string; knowledgeId: string }>, res) => {
    const entry = getById(req.params.knowledgeId);
    if (!entry || entry.project_id !== req.params.projectId) {
      throw new NotFoundError("Knowledge entry not found");
    }
    res.json(entry);
  }
);

router.post(
  "/",
  verifyProject,
  validate(CreateKnowledgeSchema),
  (req: Request<{ projectId: string }>, res) => {
    const entry = create(req.params.projectId, req.body);
    res.status(201).json(entry);
  }
);

router.patch(
  "/:knowledgeId",
  verifyProject,
  validate(UpdateKnowledgeSchema),
  (req: Request<{ projectId: string; knowledgeId: string }>, res) => {
    const existing = getById(req.params.knowledgeId);
    if (!existing || existing.project_id !== req.params.projectId) {
      throw new NotFoundError("Knowledge entry not found");
    }
    const updated = update(existing.id, req.body);
    res.json(updated);
  }
);

router.delete(
  "/:knowledgeId",
  verifyProject,
  (req: Request<{ projectId: string; knowledgeId: string }>, res) => {
    const existing = getById(req.params.knowledgeId);
    if (!existing || existing.project_id !== req.params.projectId) {
      throw new NotFoundError("Knowledge entry not found");
    }
    remove(existing.id);
    res.status(204).send();
  }
);

router.post(
  "/scan",
  verifyProject,
  (req: Request<{ projectId: string }>, res) => {
    const { projectId } = req.params;

    // Create issue for the scan task
    const issue = createIssue(projectId, {
      title: "Scan codebase and update knowledge",
      description: "Automated scan triggered from the Knowledge page.",
      created_by: "user",
    });
    eventBus.emit("issue.created", { issue });

    // Add dispatch comment to trigger librarian agent
    const comment = createComment(issue.id, {
      author_type: "user",
      content: "/dispatch librarian",
    });
    eventBus.emit("comment.added", { comment, project_id: projectId });

    res.status(201).json({ issue_id: issue.id });
  }
);

export default router;
