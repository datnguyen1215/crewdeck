import express from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { logger } from "./logger.js";
import { errorHandler } from "./middleware/error-handler.js";
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
  app.use(`${v1}/projects/:projectId/crew`, agentsRouter);
  // /agents is a backward-compatible alias for /crew
  app.use(`${v1}/projects/:projectId/agents`, agentsRouter);
  app.use(`${v1}/projects/:projectId/issues`, issuesRouter);
  app.use(`${v1}/projects/:projectId/issues/:issueId/comments`, commentsRouter);
  app.use(`${v1}/projects/:projectId`, runsRouter);
  app.use(`${v1}/projects/:projectId/activity`, activityRouter);
  app.use(`${v1}/projects/:projectId/environment`, environmentRouter);
  app.use(`${v1}/internal`, internalRouter);
  app.use(`${v1}/github-accounts`, githubAccountsRouter);

  app.use(errorHandler);

  return app;
}
