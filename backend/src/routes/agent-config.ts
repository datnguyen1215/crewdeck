import { Router, type Request } from "express";
import { z } from "zod";
import { getProject } from "../db/repositories/projects.js";
import * as agentConfigRepo from "../db/repositories/agent-config.js";
import { validate } from "../middleware/validate.js";
import { NotFoundError } from "../middleware/errors.js";

const router = Router({ mergeParams: true });

const UpsertAgentConfigSchema = z.object({
  model: z.enum(["sonnet", "opus"]).nullable(),
});

router.get("/", (req: Request<{ projectId: string }>, res) => {
  const project = getProject(req.params.projectId);
  if (!project) throw new NotFoundError("Project not found");
  res.json(agentConfigRepo.listByProject(req.params.projectId));
});

router.put(
  "/:agentId",
  validate(UpsertAgentConfigSchema),
  (req: Request<{ projectId: string; agentId: string }>, res) => {
    const project = getProject(req.params.projectId);
    if (!project) throw new NotFoundError("Project not found");
    const config = agentConfigRepo.upsert(
      req.params.projectId,
      req.params.agentId,
      req.body.model,
    );
    res.json(config);
  },
);

router.delete(
  "/:agentId",
  (req: Request<{ projectId: string; agentId: string }>, res) => {
    const project = getProject(req.params.projectId);
    if (!project) throw new NotFoundError("Project not found");
    agentConfigRepo.remove(req.params.projectId, req.params.agentId);
    res.status(204).send();
  },
);

export default router;
