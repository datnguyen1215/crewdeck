import express from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { logger } from "./logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import projectsRouter from "./routes/projects.js";
import reposRouter from "./routes/repos.js";
import crewRouter from "./routes/crew.js";
import agentsRouter from "./routes/agents.js";
import issuesRouter from "./routes/issues.js";
import commentsRouter from "./routes/comments.js";
import sessionsRouter from "./routes/sessions.js";
import activityRouter from "./routes/activity.js";
import orchestratorRouter from "./routes/orchestrator.js";
import internalRouter from "./routes/internal.js";
import githubAccountsRouter from "./routes/github-accounts.js";
import captainRouter from "./routes/captain.js";

export interface CreateAppOpts {
  corsOrigin?: string;
  silent?: boolean;
}

export function createApp(opts: CreateAppOpts = {}) {
  const app = express();

  app.use(
    cors({
      origin: opts.corsOrigin ?? false,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
    }),
  );
  app.use(express.json());

  if (!opts.silent) {
    app.use(pinoHttp({ logger }));
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  const v1 = "/api/v1";
  app.use(`${v1}/projects`, projectsRouter);
  app.use(`${v1}/projects/:projectId/repos`, reposRouter);
  app.use(`${v1}/projects/:projectId/crew`, crewRouter);
  app.use(`${v1}/projects/:projectId/crew/agents`, agentsRouter);
  app.use(`${v1}/projects/:projectId/issues`, issuesRouter);
  app.use(`${v1}/projects/:projectId/issues/:issueId/comments`, commentsRouter);
  app.use(`${v1}/projects/:projectId/sessions`, sessionsRouter);
  app.use(`${v1}/projects/:projectId/activity`, activityRouter);
  app.use(`${v1}/projects/:projectId/orchestrator`, orchestratorRouter);
  app.use(`${v1}/projects/:projectId/captain`, captainRouter);
  app.use(`${v1}/internal`, internalRouter);
  app.use(`${v1}/github-accounts`, githubAccountsRouter);

  app.use(errorHandler);

  return app;
}
