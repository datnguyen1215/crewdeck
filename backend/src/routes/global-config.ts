import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Router } from "express";
import { z } from "zod";
import * as globalConfigRepo from "../db/repositories/global-config.js";
import * as agentRunRepo from "../db/repositories/agent-runs.js";
import { validate } from "../middleware/validate.js";
import { requireScope } from "../middleware/scope.js";
import { getZaiApiKey, getOllamaProxyUrl } from "../orchestration/provider-env.js";
import * as globalEnvVarRepo from "../db/repositories/global-environment-variables.js";
import { Scope } from "../constants/scopes.js";
import { getCrewMember } from "../orchestration/crew.js";
import { getByIds } from "../db/repositories/issues.js";
import { listProjects, getProject } from "../db/repositories/projects.js";
import { getAllProjects as getAllMonitorMessages } from "../db/repositories/monitor-messages.js";

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
  "qwen-3.5-9b",
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

router.get("/model-availability", requireScope(Scope.GLOBAL_CONFIG_READ), async (_req, res) => {
  const zaiAvailable = !!getZaiApiKey();
  let ollamaAvailable = false;
  try {
    const url = getOllamaProxyUrl();
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    ollamaAvailable = response.ok;
  } catch {
    ollamaAvailable = false;
  }
  res.json({
    claude: { available: true },
    glm: { available: zaiAvailable },
    ollama: { available: ollamaAvailable },
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

router.get("/active-runs", requireScope(Scope.GLOBAL_CONFIG_READ), (req, res) => {
  const includeEvents = req.query.include_events === "true";
  const runs = agentRunRepo.listActiveRunsGlobal();

  const issueIds = runs
    .map((r) => r.issue_id)
    .filter((id): id is string => id != null);
  const issueMap = getByIds(issueIds);

  const result = runs.map((run) => {
    const agent = getCrewMember(run.agent_id);
    const issue = run.issue_id ? issueMap.get(run.issue_id) : null;
    const project = getProject(run.project_id);
    const recentEvents = includeEvents
      ? agentRunRepo.listRecentAgentRunEvents(run.id, 50)
      : [];
    return {
      ...run,
      agent_name: agent?.name ?? run.agent_id,
      agent_title: agent?.title ?? null,
      issue_title: issue?.title ?? null,
      project_name: project?.name ?? null,
      events: recentEvents,
    };
  });
  res.json(result);
});

router.get("/captain-statuses", requireScope(Scope.GLOBAL_CONFIG_READ), (_req, res) => {
  const projects = listProjects();
  const result = projects.map((project) => {
    const processingDurationMs = project.captain_processing_since
      ? Date.now() - new Date(project.captain_processing_since + "Z").getTime()
      : null;
    return {
      project_id: project.id,
      project_name: project.name,
      status: project.captain_status ?? "idle",
      detail: project.captain_status_detail ?? null,
      pending_count: project.captain_pending_count ?? 0,
      processing_since: project.captain_processing_since ?? null,
      processing_duration_ms: processingDurationMs,
    };
  });
  res.json(result);
});

router.get("/captain-monitors", requireScope(Scope.GLOBAL_CONFIG_READ), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const messages = getAllMonitorMessages(limit);
  const projects = new Map(listProjects().map((p) => [p.id, p.name]));
  const result = messages.map((msg) => ({
    ...msg,
    project_name: projects.get(msg.project_id) ?? null,
  }));
  res.json(result);
});

// GET /preflight/ollama — check if LiteLLM proxy is reachable
router.get("/preflight/ollama", requireScope(Scope.GLOBAL_CONFIG_READ), async (_req, res) => {
  const url = getOllamaProxyUrl();
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      res.json({ configured: true, url });
      return;
    }
    res.json({ configured: false });
  } catch {
    res.json({ configured: false });
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
