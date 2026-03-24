import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { logger } from "./logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { authMiddleware } from "./middleware/auth.js";
import authRouter from "./routes/auth.js";
import projectsRouter from "./routes/projects.js";
import reposRouter from "./routes/repos.js";
import agentsRouter from "./routes/agents.js";
import issuesRouter from "./routes/issues.js";
import commentsRouter from "./routes/comments.js";
import activityRouter from "./routes/activity.js";
import internalRouter from "./routes/internal.js";
import githubAccountsRouter from "./routes/github-accounts.js";
import environmentRouter from "./routes/environment.js";
import runsRouter from "./routes/runs.js";
import knowledgeRouter from "./routes/knowledge.js";
import chatRouter from "./routes/chat.js";

export interface CreateAppOpts {
  corsOrigin?: string;
  silent?: boolean;
  skipAuth?: boolean;
}

export function createApp(opts: CreateAppOpts = {}) {
  const app = express();

  // Trust proxy for correct protocol detection behind reverse proxies
  app.set("trust proxy", 1);

  app.use(
    cors({
      origin: opts.corsOrigin ?? false,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  if (!opts.silent) {
    app.use(pinoHttp({ logger }));
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Auth routes (before auth middleware)
  app.use("/auth", authRouter);

  // Auth middleware (skip in tests if needed)
  if (!opts.skipAuth) {
    app.use(authMiddleware);
  }

  const v1 = "/api/v1";
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
  app.use(`${v1}/projects/:projectId`, chatRouter);
  app.use(`${v1}/internal`, internalRouter);
  app.use(`${v1}/github-accounts`, githubAccountsRouter);

  app.use(errorHandler);

  return app;
}
