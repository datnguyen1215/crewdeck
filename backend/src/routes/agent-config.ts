import { Router } from "express";
import { z } from "zod";
import * as agentConfigRepo from "../db/repositories/agent-config.js";
import { validate } from "../middleware/validate.js";

const router = Router();

// All valid models across providers
const CLAUDE_MODELS = ["sonnet", "opus", "haiku"] as const;
const GLM_MODELS = ["glm-5.1", "glm-5", "glm-5-turbo", "glm-4.7"] as const;
const ALL_MODELS = [...CLAUDE_MODELS, ...GLM_MODELS] as const;

const UpsertAgentConfigSchema = z.object({
  provider: z.enum(["claude", "glm"]),
  model: z.enum(ALL_MODELS).nullable(),
});

router.get("/", (_req, res) => {
  res.json(agentConfigRepo.list());
});

router.put("/:agentId", validate(UpsertAgentConfigSchema), (req, res) => {
  const config = agentConfigRepo.upsert(req.params.agentId, req.body.provider, req.body.model);
  res.json(config);
});

router.delete("/:agentId/:provider", (req, res) => {
  agentConfigRepo.remove(req.params.agentId, req.params.provider);
  res.status(204).send();
});

export default router;
