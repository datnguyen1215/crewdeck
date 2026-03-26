/**
 * PTY Service
 *
 * Manages persistent tmux sessions running Claude CLI for captain terminal access.
 * Sessions run indefinitely with idle timeout cleanup.
 */
import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "../../logger.js";
import { getProject } from "../../db/repositories/projects.js";
import { config } from "../../config.js";

interface TerminalSession {
  projectId: string;
  tmuxSessionName: string;
  systemPromptPath: string;
  sshKeyPath?: string;
  createdAt: Date;
  lastAccessedAt: Date;
}

const activeSessions = new Map<string, TerminalSession>();
const pendingCreations = new Set<string>(); // Guard against concurrent session creation
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Build the system prompt for terminal captain session.
 */
const buildSystemPrompt = (projectId: string): string => {
  const project = getProject(projectId);
  if (!project) return "";

  return `You are Captain, the project assistant for CrewDeck.

## Role
You have a conversation with the user about their project. You can answer questions,
provide status updates, and take actions on their behalf (dispatch agents, create issues, etc.).

## Project: ${project.name}
${project.description || "No description"}

## Available Tools
You have access to server-side tools for:
- dispatch_agent — Spawn an agent to work on an issue
- merge_pr — Merge a ready PR
- scan_codebase — Trigger librarian scan

Ask clarifying questions when needed. Keep responses concise and actionable.
`;
};

/**
 * Set up GitHub authentication environment variables.
 */
const setupGitHubAuth = async (
  projectId: string,
  env: Record<string, string>,
): Promise<string | undefined> => {
  const project = getProject(projectId);
  if (!project?.github_account_id) return undefined;

  const { getGitHubAccount } = await import(
    "../../db/repositories/github-accounts.js"
  );
  const account = getGitHubAccount(project.github_account_id);
  if (!account) return undefined;

  env.GH_TOKEN = account.gh_token;
  const { createGitSshEnv } = await import("../../utils/git-auth.js");
  const ssh = createGitSshEnv(account.ssh_private_key);
  Object.assign(env, ssh.env);
  return ssh.keyPath;
};

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

  const tmuxSessionName = `captain-${projectId.substring(0, 8)}`;
  const systemPrompt = buildSystemPrompt(projectId);
  const systemPromptPath = join(tmpdir(), `captain-${projectId}-prompt.txt`);

  // Write system prompt to temp file
  writeFileSync(systemPromptPath, systemPrompt, "utf-8");

  // Set up environment variables
  const env: Record<string, string> = {
    ...process.env,
    CREWDECK_API_URL: `http://${config.host}:${config.port}`,
    CREWDECK_PROJECT_ID: projectId,
    CREWDECK_AGENT_ID: "captain",
    TERM: "xterm-256color",
    GIT_TERMINAL_PROMPT: "0",
  } as Record<string, string>;

  const sshKeyPath = await setupGitHubAuth(projectId, env);

  // Create tmux session running Claude CLI
  const tmuxCmd = [
    "new-session",
    "-d",
    "-s",
    tmuxSessionName,
    "claude",
    "--system-prompt-file",
    systemPromptPath,
  ];

  return new Promise((resolve) => {
    const proc = spawn("tmux", tmuxCmd, { env });

    proc.on("error", (err) => {
      logger.error({ err, projectId }, "Failed to create tmux session");
      try {
        unlinkSync(systemPromptPath);
      } catch {
        /* ignore */
      }
      pendingCreations.delete(projectId);
      resolve(null);
    });

    proc.on("exit", (code) => {
      if (code !== 0) {
        logger.error(
          { code, projectId },
          "tmux session creation failed with non-zero exit",
        );
        try {
          unlinkSync(systemPromptPath);
        } catch {
          /* ignore */
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
        createdAt: new Date(),
        lastAccessedAt: new Date(),
      };

      activeSessions.set(projectId, session);
      pendingCreations.delete(projectId);
      logger.info(
        { projectId, tmuxSessionName },
        "Terminal session created",
      );
      resolve(session);
    });
  });
}

/**
 * Get an existing terminal session.
 */
export function getTerminalSession(
  projectId: string,
): TerminalSession | null {
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
      }
      if (session.sshKeyPath) {
        try {
          unlinkSync(session.sshKeyPath);
        } catch {
          /* ignore */
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

      logger.error(
        { err, projectId },
        "Failed to kill tmux session",
      );
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
