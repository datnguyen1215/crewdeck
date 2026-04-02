/**
 * PTY Service
 *
 * Manages persistent tmux sessions running Claude CLI for captain terminal access.
 * Sessions run indefinitely with idle timeout cleanup.
 */
import { spawn, execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "../logger.js";
import { getProject } from "../db/repositories/projects.js";
import { getVCSAccount } from "../db/repositories/vcs-accounts.js";
import { config } from "../config.js";
import { getEnvironmentVariablesMap } from "../db/repositories/environment-variables.js";
import * as globalEnvVarRepo from "../db/repositories/global-environment-variables.js";
import { shellQuote } from "./shell.js";
import { buildProviderEnv } from "./provider-env.js";
import { PTY_IDLE_TIMEOUT_MS } from "../config/orchestration.js";
import { buildSystemPrompt } from "./captain-prompt.js";
import { createCaptainWorktree, setupGitHubAuth } from "./captain-worktree.js";
import { resolveModel } from "../db/repositories/agent-config.js";
import { getSystemApiKey } from "../app.js";

export interface TerminalSession {
  projectId: string;
  tmuxSessionName: string;
  systemPromptPath: string;
  sshKeyPath?: string;
  worktreePath?: string;
  createdAt: Date;
  lastAccessedAt: Date;
}

const activeSessions = new Map<string, TerminalSession>();
const pendingCreations = new Set<string>(); // Guard against concurrent session creation
const IDLE_TIMEOUT_MS = PTY_IDLE_TIMEOUT_MS;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Create a new terminal session for a project.
 */
export async function createTerminalSession(
  projectId: string,
): Promise<TerminalSession | null> {
  // Check if session already exists
  const existing = activeSessions.get(projectId);
  if (existing) {
    existing.lastAccessedAt = new Date();
    return existing;
  }

  // Guard against concurrent session creation
  if (pendingCreations.has(projectId)) {
    logger.warn({ projectId }, "Session creation already in progress");
    return null;
  }
  pendingCreations.add(projectId);

  const project = getProject(projectId);
  if (!project) {
    logger.error({ projectId }, "Project not found");
    pendingCreations.delete(projectId);
    return null;
  }

  // Set up environment for worktree creation
  let sshPrivateKey: string | undefined;
  if (project.vcs_account_id) {
    const account = getVCSAccount(project.vcs_account_id);
    if (account) {
      sshPrivateKey = account.ssh_private_key;
    }
  }

  // Create worktree for captain
  let worktreePath: string | null = null;
  try {
    worktreePath = await createCaptainWorktree(projectId, sshPrivateKey);
  } catch (err) {
    logger.error({ err, projectId }, "Failed to create captain worktree");
    pendingCreations.delete(projectId);
    return null;
  }

  const tmuxSessionName = `captain-${projectId.substring(0, 8)}`;
  const systemPrompt = await buildSystemPrompt(
    projectId,
    worktreePath ?? undefined,
  );
  const systemPromptPath = join(tmpdir(), `captain-${projectId}-prompt.txt`);

  // Write system prompt to temp file
  writeFileSync(systemPromptPath, systemPrompt, "utf-8");

  // Set up environment variables.
  // project-defined vars and platform-specific vars are baked into the tmux
  // command via `env KEY=VAL ...` so they reach the shell inside the session
  // (which inherits the tmux server's env, not the client's).
  // Full env for the tmux spawn process itself (inherits all of process.env)
  const env: Record<string, string> = { ...process.env } as Record<
    string,
    string
  >;

  // setupGitHubAuth mutates env with GH_TOKEN and GIT_SSH_COMMAND — call it first
  // so those vars are captured in captainEnvVars and baked into the tmux command.
  const sshKeyPath = await setupGitHubAuth(projectId, env);

  // process.env is passed via spawn's env option for everything else.
  // Precedence: global env vars < project env vars < platform-specific vars
  const globalEnvVars = globalEnvVarRepo.getMap();
  const projectEnvVars = getEnvironmentVariablesMap(projectId);
  const captainModel = resolveModel("captain");
  const captainEnvVars: Record<string, string> = {
    ...globalEnvVars,
    ...projectEnvVars,
    ...buildProviderEnv(captainModel),
    CREWDECK_API_URL: `http://${config.host}:${config.port}`,
    CREWDECK_PROJECT_ID: projectId,
    CREWDECK_AGENT_ID: "captain",
    TERM: "xterm-256color",
    GIT_TERMINAL_PROMPT: "0",
    // Include GitHub auth vars added by setupGitHubAuth
    ...(env.GH_TOKEN ? { GH_TOKEN: env.GH_TOKEN } : {}),
    ...(env.GIT_SSH_COMMAND ? { GIT_SSH_COMMAND: env.GIT_SSH_COMMAND } : {}),
    ...(getSystemApiKey() ? { CREWDECK_API_KEY: getSystemApiKey()! } : {}),
  };
  // Merge captainEnvVars back into env for the spawn call
  Object.assign(env, captainEnvVars);

  // Kill any stale tmux session from a previous server run
  try {
    execSync(`tmux kill-session -t ${tmuxSessionName}`, { stdio: "ignore" });
  } catch {
    /* no existing session — fine */
    logger.debug(
      { projectId, tmuxSessionName },
      "No stale tmux session to kill",
    );
  }

  // Create tmux session running Claude CLI
  const tmuxCmd = [
    "new-session",
    "-d",
    "-s",
    tmuxSessionName,
    ...(worktreePath ? ["-c", worktreePath] : []),
    "env",
    ...Object.entries(captainEnvVars).map(
      ([k, v]) => `${shellQuote(k)}=${shellQuote(String(v))}`,
    ),
    "claude",
    "--model",
    captainModel,
    "--system-prompt-file",
    systemPromptPath,
    "--dangerously-skip-permissions",
  ];

  return new Promise((resolve) => {
    const proc = spawn("tmux", tmuxCmd, { env });
    let resolved = false;

    proc.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      logger.error({ err, projectId }, "Failed to create tmux session");
      try {
        unlinkSync(systemPromptPath);
      } catch {
        /* ignore */
        logger.debug(
          { projectId, systemPromptPath },
          "Failed to remove system prompt temp file",
        );
      }
      pendingCreations.delete(projectId);
      resolve(null);
    });

    proc.on("exit", (code) => {
      if (resolved) return;
      resolved = true;
      if (code !== 0) {
        logger.error(
          { code, projectId },
          "tmux session creation failed with non-zero exit",
        );
        try {
          unlinkSync(systemPromptPath);
        } catch {
          /* ignore */
          logger.debug(
            { projectId, systemPromptPath },
            "Failed to remove system prompt temp file",
          );
        }
        pendingCreations.delete(projectId);
        resolve(null);
        return;
      }

      const session: TerminalSession = {
        projectId,
        tmuxSessionName,
        systemPromptPath,
        sshKeyPath,
        worktreePath: worktreePath ?? undefined,
        createdAt: new Date(),
        lastAccessedAt: new Date(),
      };

      activeSessions.set(projectId, session);
      pendingCreations.delete(projectId);
      logger.info(
        { projectId, tmuxSessionName, worktreePath },
        "Terminal session created",
      );
      resolve(session);
    });
  });
}

/**
 * Get an existing terminal session.
 */
export function getTerminalSession(projectId: string): TerminalSession | null {
  const session = activeSessions.get(projectId);
  if (session) {
    session.lastAccessedAt = new Date();
  }
  return session || null;
}

/**
 * Destroy a terminal session.
 */
export async function destroyTerminalSession(
  projectId: string,
): Promise<boolean> {
  const session = activeSessions.get(projectId);
  if (!session) return false;

  return new Promise((resolve) => {
    let resolved = false;
    const proc = spawn("tmux", ["kill-session", "-t", session.tmuxSessionName]);

    proc.on("exit", () => {
      if (resolved) return;
      resolved = true;

      activeSessions.delete(projectId);

      // Clean up temp files
      try {
        unlinkSync(session.systemPromptPath);
      } catch {
        /* ignore */
        logger.debug(
          { projectId, path: session.systemPromptPath },
          "Failed to remove system prompt temp file",
        );
      }
      if (session.sshKeyPath) {
        try {
          unlinkSync(session.sshKeyPath);
        } catch {
          /* ignore */
          logger.debug(
            { projectId, path: session.sshKeyPath },
            "Failed to remove SSH key temp file",
          );
        }
      }

      logger.info(
        { projectId, tmuxSessionName: session.tmuxSessionName },
        "Terminal session destroyed",
      );
      resolve(true);
    });

    proc.on("error", (err) => {
      if (resolved) return;
      resolved = true;

      logger.error({ err, projectId }, "Failed to kill tmux session");
      resolve(false);
    });
  });
}

/**
 * Clean up idle sessions.
 */
function cleanupIdleSessions(): void {
  const now = Date.now();
  // Copy entries before iterating to avoid race with async destroyTerminalSession
  const entries = Array.from(activeSessions);
  for (const [projectId, session] of entries) {
    const idleTime = now - session.lastAccessedAt.getTime();
    if (idleTime > IDLE_TIMEOUT_MS) {
      logger.info(
        { projectId, idleMinutes: Math.floor(idleTime / 60000) },
        "Cleaning up idle terminal session",
      );
      destroyTerminalSession(projectId).catch((err) => {
        logger.error({ err, projectId }, "Failed to cleanup idle session");
      });
    }
  }
}

/**
 * Initialize PTY service.
 */
export function initPtyService(): void {
  cleanupInterval = setInterval(cleanupIdleSessions, 60000); // Check every minute
  logger.info("PTY service initialized");
}

/**
 * Shutdown PTY service and clean up all sessions.
 */
export async function shutdownPtyService(): Promise<void> {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }

  const promises = Array.from(activeSessions.keys()).map((projectId) =>
    destroyTerminalSession(projectId),
  );

  await Promise.all(promises);
  logger.info("PTY service shutdown complete");
}
