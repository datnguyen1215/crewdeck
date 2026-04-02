import { Router } from "express";
import { z } from "zod";
import * as globalConfigRepo from "../db/repositories/global-config.js";
import { validate } from "../middleware/validate.js";
import { getZaiApiKey } from "../orchestration/provider-env.js";

const router = Router();

const ALL_MODELS = [
  "sonnet",
  "opus",
  "haiku",
  "glm-5.1",
  "glm-5",
  "glm-5-turbo",
  "glm-4.7",
] as const;

const SetDefaultModelSchema = z.object({
  model: z.enum(ALL_MODELS),
});

router.get("/", (_req, res) => {
  res.json({ defaultModel: globalConfigRepo.getDefaultModel() });
});

router.get("/default-model", (_req, res) => {
  res.json({ model: globalConfigRepo.getDefaultModel() });
});

router.put("/default-model", validate(SetDefaultModelSchema), (req, res) => {
  globalConfigRepo.setDefaultModel(req.body.model);
  res.json({ model: globalConfigRepo.getDefaultModel() });
});

router.get("/model-availability", (_req, res) => {
  const zaiAvailable = !!getZaiApiKey();
  res.json({
    claude: { available: true },
    glm: { available: zaiAvailable },
  });
});

export default router;
