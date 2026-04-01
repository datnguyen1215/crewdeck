import { Router } from "express";
import { z } from "zod";
import * as globalConfigRepo from "../db/repositories/global-config.js";
import { validate } from "../middleware/validate.js";
import { switchProvider } from "../services/switch-provider.js";
import { restartCaptainSessions } from "../services/restart-captain-sessions.js";

const router = Router();

const SetProviderSchema = z.object({
  provider: z.enum(["claude", "glm"]),
});

const SetZaiApiKeySchema = z.object({
  key: z.string().min(1).nullable(),
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
  res.json({
    available: !!(process.env.ZAI_API_KEY || globalConfigRepo.getZaiApiKey()),
  });
});

router.get("/zai-api-key-configured", (_req, res) => {
  res.json({ configured: !!globalConfigRepo.getZaiApiKey() });
});

router.put("/zai-api-key", validate(SetZaiApiKeySchema), async (req, res) => {
  const { key } = req.body;
  try {
    globalConfigRepo.setZaiApiKey(key);
    // Restart Captain sessions so they pick up the new key
    await restartCaptainSessions();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update API key" });
  }
});

export default router;
