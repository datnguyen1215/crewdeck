import { Router } from "express";
import { z } from "zod";
import * as globalConfigRepo from "../db/repositories/global-config.js";
import * as agentRunRepo from "../db/repositories/agent-runs.js";
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

const SetMaxConcurrencySchema = z.object({
  maxConcurrency: z.number().int().min(1).max(50),
});

const SetMaxChainDepthSchema = z.object({
  maxChainDepth: z.number().int().min(1).max(100),
});

const SetAgentTimeoutSchema = z.object({
  agentTimeoutMinutes: z.number().int().min(1).max(60),
});

router.get("/", (_req, res) => {
  res.json({
    defaultModel: globalConfigRepo.getDefaultModel(),
    maxConcurrency: globalConfigRepo.getMaxConcurrency(),
    maxChainDepth: globalConfigRepo.getMaxChainDepth(),
    agentTimeoutMinutes: globalConfigRepo.getAgentTimeoutMinutes(),
  });
});

router.get("/default-model", (_req, res) => {
  res.json({ model: globalConfigRepo.getDefaultModel() });
});

router.put("/default-model", validate(SetDefaultModelSchema), (req, res) => {
  globalConfigRepo.setDefaultModel(req.body.model);
  res.json({ model: globalConfigRepo.getDefaultModel() });
});

router.get("/max-concurrency", (_req, res) => {
  res.json({ maxConcurrency: globalConfigRepo.getMaxConcurrency() });
});

router.put("/max-concurrency", validate(SetMaxConcurrencySchema), (req, res) => {
  globalConfigRepo.setMaxConcurrency(req.body.maxConcurrency);
  res.json({ maxConcurrency: globalConfigRepo.getMaxConcurrency() });
});

router.get("/max-chain-depth", (_req, res) => {
  res.json({ maxChainDepth: globalConfigRepo.getMaxChainDepth() });
});

router.put("/max-chain-depth", validate(SetMaxChainDepthSchema), (req, res) => {
  globalConfigRepo.setMaxChainDepth(req.body.maxChainDepth);
  res.json({ maxChainDepth: globalConfigRepo.getMaxChainDepth() });
});

router.get("/agent-timeout-minutes", (_req, res) => {
  res.json({ agentTimeoutMinutes: globalConfigRepo.getAgentTimeoutMinutes() });
});

router.put(
  "/agent-timeout-minutes",
  validate(SetAgentTimeoutSchema),
  (req, res) => {
    globalConfigRepo.setAgentTimeoutMinutes(req.body.agentTimeoutMinutes);
    res.json({ agentTimeoutMinutes: globalConfigRepo.getAgentTimeoutMinutes() });
  },
);

router.get("/active-agents", (_req, res) => {
  res.json({
    activeAgents: agentRunRepo.countRunningGlobal(),
    maxConcurrency: globalConfigRepo.getMaxConcurrency(),
  });
});

router.get("/model-availability", (_req, res) => {
  const zaiAvailable = !!getZaiApiKey();
  res.json({
    claude: { available: true },
    glm: { available: zaiAvailable },
  });
});

export default router;
