import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { db } from "./db/index.js";
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
import { claudeCodeAdapter } from "./agent/adapters/claude-code.js";
import { ProcessMonitor } from "./agent/process-monitor.js";
import { cleanupOrphans, gracefulShutdown } from "./agent/orphan-cleanup.js";

const app = express();

app.use(cors({
  origin: config.corsOrigin,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));
app.use(express.json());
app.use(pinoHttp({ logger }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// TODO: Add authentication middleware before production. All routes are currently unauthenticated.
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
app.use(`${v1}/internal`, internalRouter);

// Centralized error handler — must be last
app.use(errorHandler);

const processMonitor = new ProcessMonitor(claudeCodeAdapter);

async function startupSequence(): Promise<void> {
  // Clean up any tmux sessions left over from a previous backend process,
  // then start the monitor — order matters to avoid a race between cleanup and monitoring.
  await cleanupOrphans();
  processMonitor.start();
}

app.listen(config.port, config.host, () => {
  logger.info(`Server started on port ${config.port}`);
  void startupSequence();
});

// Graceful shutdown
async function shutdown() {
  processMonitor.stop();
  await gracefulShutdown(claudeCodeAdapter);
  db.close();
  process.exit(0);
}
process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
