import { Router } from "express";
import { z } from "zod";
import * as globalConfigRepo from "../db/repositories/global-config.js";
import { validate } from "../middleware/validate.js";
import { switchProvider } from "../services/switch-provider.js";
import { getZaiApiKey } from "../orchestration/provider-env.js";

const router = Router();

const SetProviderSchema = z.object({
  provider: z.enum(["claude", "glm"]),
});

router.get("/", (_req, res) => {
  res.json({ provider: globalConfigRepo.getProvider() });
});

router.put("/provider", validate(SetProviderSchema), async (req, res) => {
  const { provider } = req.body;

  try {
    const newProvider = await switchProvider(provider);
    res.json({ provider: newProvider });
  } catch (err: any) {
    if (err?.status === 409) {
      return res
        .status(409)
        .json({ error: "Provider switch already in progress" });
    }
    res.status(500).json({ error: "Failed to switch provider" });
  }
});

router.get("/glm-available", (_req, res) => {
  res.json({ available: !!getZaiApiKey() });
});

export default router;
