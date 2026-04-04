import { Router, type Request } from "express";
import {
  listByProject,
  getById,
  create,
  update,
  remove,
} from "../db/repositories/knowledge.js";
import { validate } from "../middleware/validate.js";
import { requireScope } from "../middleware/scope.js";
import { verifyProject, createOwnershipVerifier } from "../middleware/ownership.js";
import { Scope } from "../constants/scopes.js";
import {
  CreateKnowledgeSchema,
  UpdateKnowledgeSchema,
} from "../schemas/validation.js";
import { spawnScan } from "../orchestration/spawner.js";

const router = Router({ mergeParams: true });

const verifyKnowledgeOwner = createOwnershipVerifier(getById, "Knowledge entry", "project_id");

router.get("/", requireScope(Scope.KNOWLEDGE_READ), verifyProject, (req: Request<{ projectId: string }>, res) => {
  const entries = listByProject(req.params.projectId);
  res.json(entries);
});

router.get(
  "/:knowledgeId",
  requireScope(Scope.KNOWLEDGE_READ),
  verifyProject,
  (req: Request<{ projectId: string; knowledgeId: string }>, res) => {
    const entry = verifyKnowledgeOwner(req.params.knowledgeId, req.params.projectId);
    res.json(entry);
  }
);

router.post(
  "/",
  requireScope(Scope.KNOWLEDGE_WRITE),
  verifyProject,
  validate(CreateKnowledgeSchema),
  (req: Request<{ projectId: string }>, res) => {
    const entry = create(req.params.projectId, req.body);
    res.status(201).json(entry);
  }
);

router.patch(
  "/:knowledgeId",
  requireScope(Scope.KNOWLEDGE_WRITE),
  verifyProject,
  validate(UpdateKnowledgeSchema),
  (req: Request<{ projectId: string; knowledgeId: string }>, res) => {
    const existing = verifyKnowledgeOwner(req.params.knowledgeId, req.params.projectId);
    const updated = update(existing.id, req.body);
    res.json(updated);
  }
);

router.delete(
  "/:knowledgeId",
  requireScope(Scope.KNOWLEDGE_DELETE),
  verifyProject,
  (req: Request<{ projectId: string; knowledgeId: string }>, res) => {
    const existing = verifyKnowledgeOwner(req.params.knowledgeId, req.params.projectId);
    remove(existing.id);
    res.status(204).send();
  }
);

router.post(
  "/scan",
  requireScope(Scope.KNOWLEDGE_SCAN),
  verifyProject,
  async (req: Request<{ projectId: string }>, res, next) => {
    try {
      const agentRunId = await spawnScan(req.params.projectId);
      res.status(201).json({ agent_run_id: agentRunId });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
