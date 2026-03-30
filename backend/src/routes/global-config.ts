import { Router } from "express";
import { z } from "zod";
import * as globalConfigRepo from "../db/repositories/global-config.js";
import { validate } from "../middleware/validate.js";
import { logger } from "../logger.js";

const router = Router();

const SetProviderSchema = z.object({
  provider: z.enum(["claude", "glm"]),
});

// Guard against concurrent provider switch requests to prevent duplicate cleanup intervals
let providerSwitchInProgress = false;

router.get("/", (_req, res) => {
  res.json({ provider: globalConfigRepo.getProvider() });
});

router.put("/provider", validate(SetProviderSchema), async (req, res) => {
  const { provider } = req.body;

  // Prevent concurrent provider switches which could create duplicate cleanup intervals
  if (providerSwitchInProgress) {
    return res.status(409).json({ error: "Provider switch already in progress" });
  }
  providerSwitchInProgress = true;

  const { shutdownPtyService, initPtyService } = await import(
    "../orchestration/pty-service.js"
  );

  try {
    // Order matters:
    // 1. Shutdown first to kill existing sessions and clear cleanup interval
    // 2. Update config so new sessions use the new provider
    // 3. Init last to start new cleanup interval (any sessions created after use new provider)
    await shutdownPtyService();
    globalConfigRepo.setProvider(provider);
    initPtyService();

    res.json({ provider: globalConfigRepo.getProvider() });
  } catch (err) {
    logger.error({ err }, "Failed to switch provider");
    // Always restart PTY service to ensure cleanup interval is running
    initPtyService();
    res.status(500).json({ error: "Failed to switch provider" });
  } finally {
    providerSwitchInProgress = false;
  }
});

router.get("/glm-available", (_req, res) => {
  res.json({ available: !!process.env.ZAI_API_KEY });
});

export default router;
