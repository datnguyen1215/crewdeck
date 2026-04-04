import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Router } from "express";
import { z } from "zod";
import * as globalConfigRepo from "../db/repositories/global-config.js";
import * as agentRunRepo from "../db/repositories/agent-runs.js";
import { validate } from "../middleware/validate.js";
import { requireScope } from "../middleware/scope.js";
import { getZaiApiKey } from "../orchestration/provider-env.js";
import * as globalEnvVarRepo from "../db/repositories/global-environment-variables.js";
import { Scope } from "../constants/scopes.js";

const execFileAsync = promisify(execFile);

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

router.get("/", requireScope(Scope.GLOBAL_CONFIG_READ), (_req, res) => {
  res.json({
    defaultModel: globalConfigRepo.getDefaultModel(),
    maxConcurrency: globalConfigRepo.getMaxConcurrency(),
    maxChainDepth: globalConfigRepo.getMaxChainDepth(),
    agentTimeoutMinutes: globalConfigRepo.getAgentTimeoutMinutes(),
  });
});

router.get("/default-model", requireScope(Scope.GLOBAL_CONFIG_READ), (_req, res) => {
  res.json({ model: globalConfigRepo.getDefaultModel() });
});

router.put("/default-model", requireScope(Scope.GLOBAL_CONFIG_WRITE), validate(SetDefaultModelSchema), (req, res) => {
  globalConfigRepo.setDefaultModel(req.body.model);
  res.json({ model: globalConfigRepo.getDefaultModel() });
});

router.get("/max-concurrency", requireScope(Scope.GLOBAL_CONFIG_READ), (_req, res) => {
  res.json({ maxConcurrency: globalConfigRepo.getMaxConcurrency() });
});

router.put("/max-concurrency", requireScope(Scope.GLOBAL_CONFIG_WRITE), validate(SetMaxConcurrencySchema), (req, res) => {
  globalConfigRepo.setMaxConcurrency(req.body.maxConcurrency);
  res.json({ maxConcurrency: globalConfigRepo.getMaxConcurrency() });
});

router.get("/max-chain-depth", requireScope(Scope.GLOBAL_CONFIG_READ), (_req, res) => {
  res.json({ maxChainDepth: globalConfigRepo.getMaxChainDepth() });
});

router.put("/max-chain-depth", requireScope(Scope.GLOBAL_CONFIG_WRITE), validate(SetMaxChainDepthSchema), (req, res) => {
  globalConfigRepo.setMaxChainDepth(req.body.maxChainDepth);
  res.json({ maxChainDepth: globalConfigRepo.getMaxChainDepth() });
});

router.get("/agent-timeout-minutes", requireScope(Scope.GLOBAL_CONFIG_READ), (_req, res) => {
  res.json({ agentTimeoutMinutes: globalConfigRepo.getAgentTimeoutMinutes() });
});

router.put(
  "/agent-timeout-minutes",
  requireScope(Scope.GLOBAL_CONFIG_WRITE),
  validate(SetAgentTimeoutSchema),
  (req, res) => {
    globalConfigRepo.setAgentTimeoutMinutes(req.body.agentTimeoutMinutes);
    res.json({ agentTimeoutMinutes: globalConfigRepo.getAgentTimeoutMinutes() });
  },
);

router.get("/active-agents", requireScope(Scope.GLOBAL_CONFIG_READ), (_req, res) => {
  res.json({
    activeAgents: agentRunRepo.countRunningGlobal(),
    maxConcurrency: globalConfigRepo.getMaxConcurrency(),
  });
});

router.get("/model-availability", requireScope(Scope.GLOBAL_CONFIG_READ), (_req, res) => {
  const zaiAvailable = !!getZaiApiKey();
  res.json({
    claude: { available: true },
    glm: { available: zaiAvailable },
  });
});

// --- Preflight check endpoints ---

// GET /preflight/claude-cli — check if claude CLI is installed
router.get("/preflight/claude-cli", requireScope(Scope.GLOBAL_CONFIG_READ), async (_req, res) => {
  try {
    const { stdout: path } = await execFileAsync("which", ["claude"]);
    const trimmedPath = path.trim();
    if (!trimmedPath) {
      res.json({ installed: false });
      return;
    }
    try {
      const { stdout: versionOut } = await execFileAsync(trimmedPath, [
        "--version",
      ]);
      res.json({
        installed: true,
        version: versionOut.trim(),
        path: trimmedPath,
      });
    } catch {
      res.json({ installed: true, path: trimmedPath });
    }
  } catch {
    res.json({ installed: false });
  }
});

// GET /preflight/claude-auth — check if claude CLI is authenticated
router.get("/preflight/claude-auth", requireScope(Scope.GLOBAL_CONFIG_READ), async (_req, res) => {
  try {
    await execFileAsync(
      "claude",
      ["-p", "ping", "--output-format", "json", "--max-turns", "1"],
      { timeout: 15_000 },
    );
    res.json({ authenticated: true });
  } catch (err: unknown) {
    const error = err as {
      stderr?: string;
      stdout?: string;
      message?: string;
    };
    const msg = (error.stderr || error.stdout || error.message || "")
      .trim()
      .slice(0, 500);
    res.json({
      authenticated: false,
      error: msg || "Authentication check failed",
    });
  }
});

// GET /preflight/zai — check if Z.AI API key is configured
router.get("/preflight/zai", requireScope(Scope.GLOBAL_CONFIG_READ), (_req, res) => {
  if (process.env.ZAI_API_KEY) {
    res.json({ configured: true, source: "env" as const });
    return;
  }
  const globalVar = globalEnvVarRepo.getByKey("ZAI_API_KEY");
  if (globalVar) {
    res.json({ configured: true, source: "database" as const });
    return;
  }
  res.json({ configured: false });
});

export default router;
