import { Router } from "express";
import { z } from "zod";
import * as globalConfigRepo from "../db/repositories/global-config.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const SetProviderSchema = z.object({
  provider: z.enum(["claude", "glm"]),
});

router.get("/", (_req, res) => {
  res.json({ provider: globalConfigRepo.getProvider() });
});

router.put("/provider", validate(SetProviderSchema), async (req, res) => {
  const { provider } = req.body;

  // Kill existing Captain terminal sessions when provider changes
  // so they restart with new env vars
  const { shutdownPtyService, initPtyService } = await import(
    "../orchestration/pty-service.js"
  );
  await shutdownPtyService();

  globalConfigRepo.setProvider(provider);

  // Restart PTY service for new sessions
  initPtyService();

  res.json({ provider: globalConfigRepo.getProvider() });
});

router.get("/glm-available", (_req, res) => {
  res.json({ available: !!process.env.ZAI_API_KEY });
});

export default router;
