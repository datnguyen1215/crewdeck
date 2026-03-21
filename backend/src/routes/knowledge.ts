import { Router, type Request } from "express";
import {
  listByProject,
  getById,
  create,
  update,
  remove,
} from "../db/repositories/knowledge.js";
import { validate } from "../middleware/validate.js";
import { verifyProject } from "../middleware/ownership.js";
import { NotFoundError } from "../middleware/errors.js";
import {
  CreateKnowledgeSchema,
  UpdateKnowledgeSchema,
} from "../schemas/validation.js";

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

export default router;
