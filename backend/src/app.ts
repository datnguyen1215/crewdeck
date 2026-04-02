import express from "express";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { logger } from "./logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requireAuth } from "./middleware/auth.js";
import { ensureSystemKey } from "./db/repositories/api-keys.js";
import projectsRouter from "./routes/projects.js";
import reposRouter from "./routes/repos.js";
import agentsRouter from "./routes/agents.js";
import issuesRouter from "./routes/issues.js";
import commentsRouter from "./routes/comments.js";
import activityRouter from "./routes/activity.js";
import internalRouter from "./routes/internal.js";
import vcsAccountsRouter from "./routes/vcs-accounts.js";
import environmentRouter from "./routes/environment.js";
import runsRouter from "./routes/runs.js";
import knowledgeRouter from "./routes/knowledge.js";
import agentConfigRouter from "./routes/agent-config.js";
import globalConfigRouter from "./routes/global-config.js";
import globalEnvironmentRouter from "./routes/global-environment.js";
import terminalRouter from "./routes/terminal.js";
import monitorRouter from "./routes/monitor.js";
import authRouter from "./routes/auth.js";
import apiKeysRouter from "./routes/api-keys.js";

// In-memory system API key — set once on startup, used for spawning agents/captains
let systemApiKey: string | null = null;

export function getSystemApiKey(): string | null {
  return systemApiKey;
}

export interface CreateAppOpts {
  silent?: boolean;
  skipAuth?: boolean;
}

export function createApp(opts: CreateAppOpts = {}) {
  // Ensure system API key exists — always recreates to get raw key in memory
  if (!systemApiKey && !opts.skipAuth) {
    systemApiKey = ensureSystemKey();
  }

  const app = express();

  // Trust the first reverse proxy so req.ip reflects the real client IP.
  // Override with TRUST_PROXY env (e.g. "loopback", "1").
  app.set("trust proxy", process.env.TRUST_PROXY ?? 1);

  app.use(express.json());
  app.use(cookieParser());

  if (!opts.silent) {
    app.use(pinoHttp({ logger }));
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Auth routes (public — no session required)
  const v1 = "/api/v1";
  app.use(`${v1}/auth`, authRouter);

  // All other routes require authentication (unless skipped for testing)
  if (!opts.skipAuth) {
    app.use(requireAuth);
  }
  app.use(`${v1}/projects`, projectsRouter);
  app.use(`${v1}/projects/:projectId/repos`, reposRouter);
  app.use(`${v1}/crew`, agentsRouter);
  // /agents is a backward-compatible alias for /crew
  app.use(`${v1}/agents`, agentsRouter);
  app.use(`${v1}/projects/:projectId/issues`, issuesRouter);
  app.use(`${v1}/projects/:projectId/issues/:issueId/comments`, commentsRouter);
  app.use(`${v1}/projects/:projectId`, runsRouter);
  app.use(`${v1}/projects/:projectId/activity`, activityRouter);
  app.use(`${v1}/projects/:projectId/environment`, environmentRouter);
  app.use(`${v1}/projects/:projectId/knowledge`, knowledgeRouter);
  app.use(`${v1}/agent-config`, agentConfigRouter);
  app.use(`${v1}/global-config`, globalConfigRouter);
  app.use(`${v1}/global-config/environment`, globalEnvironmentRouter);
  app.use(`${v1}/projects/:projectId`, terminalRouter);
  app.use(`${v1}/projects/:projectId`, monitorRouter);
  app.use(`${v1}/internal`, internalRouter);
  app.use(`${v1}/vcs-accounts`, vcsAccountsRouter);
  app.use(`${v1}/api-keys`, apiKeysRouter);

  app.use(errorHandler);

  return app;
}
