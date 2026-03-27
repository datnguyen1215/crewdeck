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
import { config } from "../config.js";

interface TerminalSession {
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
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Build the system prompt for terminal captain session.
 */
const buildSystemPrompt = async (projectId: string, worktreePath?: string): Promise<string> => {
  const project = getProject(projectId);
  if (!project) return "";

  const { getActiveProcessCount } = await import("./processes.js");
  const runningAgents = getActiveProcessCount(projectId);

  // Get project knowledge
  const { listByProject } = await import("../db/repositories/knowledge.js");
  const projectKnowledge = listByProject(projectId);

  // Get repo info
  const { listRepos } = await import("../db/repositories/repos.js");
  const repos = listRepos(projectId);
  const repo = repos.length > 0 ? repos[0] : null;

  const parts: string[] = [];

  parts.push(`You are Captain, the project assistant for CrewDeck.

## Role
You have a conversation with the user about their project. You can answer questions,
provide status updates, and take actions on their behalf (dispatch agents, create issues, etc.).

## Project: ${project.name}
${project.description || "No description"}

## Current Capacity
- Running agents: ${runningAgents}
- Max concurrency: ${project.max_concurrency}
- Available slots: ${Math.max(0, project.max_concurrency - runningAgents)}`);

  // Inject project knowledge
  const INJECT_CATEGORIES = new Set(["workflows", "conventions"]);
  if (projectKnowledge.length > 0) {
    const injected = projectKnowledge.filter((k) => INJECT_CATEGORIES.has(k.category));
    if (injected.length > 0) {
      const entries = injected
        .map((k) => `### ${k.title} (${k.category})\n${k.content}`)
        .join("\n\n");
      parts.push(`## Project Knowledge\n${entries}`);
    }
  }

  // Repository info
  if (repo && worktreePath) {
    parts.push(`## Repository\n${repo.name} at ${worktreePath}`);
  }

  // API Reference
  parts.push(`## API Reference
The following environment variables are available:
- CREWDECK_API_URL — base URL of the backend API
- CREWDECK_PROJECT_ID — current project ID
- CREWDECK_AGENT_ID — captain

### Issues API
\`\`\`bash
# List issues (filterable by status)
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues?status=open,in_progress"

# Get issue details (includes comments, PRs, runs)
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/<ISSUE_ID>"

# Create issue
curl -X POST "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "Issue title", "description": "Description"}'

# Update issue
curl -X PUT "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/<ISSUE_ID>" \\
  -H "Content-Type: application/json" \\
  -d '{"status": "done"}'

# Add comment
curl -X POST "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/<ISSUE_ID>/comments" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Comment text", "author_type": "captain"}'
\`\`\`

### Agent Runs API
\`\`\`bash
# List currently running/queued agents
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/active-runs"

# List recent runs
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/runs?limit=10"

# Get run details
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/runs/<RUN_ID>"
\`\`\`

### Activity API
\`\`\`bash
# Get activity log
curl "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/activity?limit=20"
\`\`\`

### Knowledge API
\`\`\`bash
# List knowledge titles (returns id, title, category)
curl "$CREWDECK_API_URL/api/v1/internal/knowledge/titles?project_id=$CREWDECK_PROJECT_ID"

# Get full knowledge entry
curl "$CREWDECK_API_URL/api/v1/internal/knowledge/get?project_id=$CREWDECK_PROJECT_ID&knowledge_id=<ID>"
\`\`\`

## Available Actions
You have access to server-side tools for:
- **dispatch_agent** — Spawn an agent (engineer, lead, docs, librarian) to work on an issue
- **merge_pr** — Merge a ready PR
- **scan_codebase** — Trigger librarian scan to update project knowledge
- **create_issue** — Create a new issue via the Issues API above
- **update_issue** — Update issue status via the Issues API above
- **comment** — Post comments on issues via the Issues API above

Ask clarifying questions when needed. Keep responses concise and actionable.`);

  return parts.join("\n\n");
};

/**
 * Set up GitHub authentication environment variables.
 */
const setupGitHubAuth = async (
  projectId: string,
  env: Record<string, string>,
): Promise<string | undefined> => {
  const project = getProject(projectId);
  if (!project?.vcs_account_id) return undefined;

  const { getVCSAccount } = await import(
    "../db/repositories/vcs-accounts.js"
  );
  const account = getVCSAccount(project.vcs_account_id);
  if (!account) return undefined;

  env.GH_TOKEN = account.token;
  const { createGitSshEnv } = await import("../utils/git-auth.js");
  const ssh = createGitSshEnv(account.ssh_private_key);
  Object.assign(env, ssh.env);
  return ssh.keyPath;
};

/**
 * Create a worktree for captain chat session.
 * Similar to issue worktrees but long-lived and named differently.
 */
async function createCaptainWorktree(
  projectId: string,
  sshPrivateKey?: string,
): Promise<string | null> {
  const { listRepos } = await import("../db/repositories/repos.js");
  const repos = listRepos(projectId);
  if (repos.length === 0) {
    logger.warn({ projectId }, "No repos found for project, cannot create worktree");
    return null;
  }

  const repo = repos[0];
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);
  const { toContainerPath } = await import("../utils/paths.js");
  const { shellQuote } = await import("./shell.js");
  const { createGitSshEnv, cleanupSshKey } = await import("../utils/git-auth.js");

  const branchName = `crewdeck/captain-${projectId.slice(0, 8)}`;
  const repoPath = toContainerPath(repo.local_path);
  const worktreePath = join(tmpdir(), "crewdeck-worktrees", branchName);

  // Try to fetch latest from origin
  let fetchSucceeded = false;
  const ssh = sshPrivateKey ? createGitSshEnv(sshPrivateKey) : null;
  try {
    const fetchEnv = { ...process.env, ...ssh?.env, GIT_TERMINAL_PROMPT: "0" };
    await execAsync(`git -C ${shellQuote(repoPath)} fetch origin`, { env: fetchEnv });
    fetchSucceeded = true;
  } catch (err) {
    logger.warn({ projectId, err }, "Failed to fetch from origin for captain worktree");
  } finally {
    if (ssh) cleanupSshKey(ssh.keyPath);
  }

  const startPoint = fetchSucceeded ? `origin/${repo.default_branch}` : repo.default_branch;

  // Prune stale worktree entries
  await execAsync(`git -C ${shellQuote(repoPath)} worktree prune`);

  // Check if worktree already exists and is registered
  let worktreeExists = false;
  try {
    const { stdout } = await execAsync(`git -C ${shellQuote(repoPath)} worktree list --porcelain`);
    const lines = stdout.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("worktree ") && lines[i].includes(worktreePath)) {
        worktreeExists = true;
        break;
      }
    }
  } catch {
    // worktree list failed, assume doesn't exist
  }

  if (worktreeExists) {
    // Worktree already registered, reuse it
    logger.info({ projectId, worktreePath }, "Reusing existing captain worktree");

    // Rebase onto latest base branch
    if (fetchSucceeded) {
      try {
        await execAsync(`git -C ${shellQuote(worktreePath)} rebase ${shellQuote(startPoint)}`);
      } catch (err) {
        // Abort rebase if it fails
        await execAsync(`git -C ${shellQuote(worktreePath)} rebase --abort`).catch(() => {});
        logger.warn({ projectId, err }, "Failed to rebase captain worktree");
      }
    }
  } else {
    // Worktree not registered, need to add it
    // Check if branch exists
    let branchExists = false;
    try {
      await execAsync(`git -C ${shellQuote(repoPath)} rev-parse --verify ${shellQuote(branchName)}`);
      branchExists = true;
    } catch {
      // Branch doesn't exist
    }

    if (branchExists) {
      // Reuse existing branch
      await execAsync(
        `git -C ${shellQuote(repoPath)} worktree add ${shellQuote(worktreePath)} ${shellQuote(branchName)}`,
      );

      // Rebase onto latest base branch
      if (fetchSucceeded) {
        try {
          await execAsync(`git -C ${shellQuote(worktreePath)} rebase ${shellQuote(startPoint)}`);
        } catch (err) {
          // Abort rebase if it fails
          await execAsync(`git -C ${shellQuote(worktreePath)} rebase --abort`).catch(() => {});
          logger.warn({ projectId, err }, "Failed to rebase captain worktree");
        }
      }
    } else {
      // Create new branch
      await execAsync(
        `git -C ${shellQuote(repoPath)} worktree add -b ${shellQuote(branchName)} ${shellQuote(worktreePath)} ${shellQuote(startPoint)}`,
      );
    }
  }

  // Inject Claude Code settings to disable AI attribution
  const claudeDir = join(worktreePath, ".claude");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(
    join(claudeDir, "settings.json"),
    JSON.stringify({ attribution: { commit: "", pr: "" } }),
  );

  logger.info({ projectId, worktreePath }, "Captain worktree created");
  return worktreePath;
}

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
    const { getVCSAccount } = await import("../db/repositories/vcs-accounts.js");
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
  const systemPrompt = await buildSystemPrompt(projectId, worktreePath ?? undefined);
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

  // Kill any stale tmux session from a previous server run
  try {
    execSync(`tmux kill-session -t ${tmuxSessionName}`, { stdio: "ignore" });
  } catch {
    /* no existing session — fine */
  }

  // Create tmux session running Claude CLI
  const tmuxCmd = [
    "new-session",
    "-d",
    "-s",
    tmuxSessionName,
    ...(worktreePath ? ["-c", worktreePath] : []),
    "claude",
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
