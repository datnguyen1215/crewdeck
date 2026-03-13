import { exec } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../logger.js";
import { listRunningSessions, updateSession } from "../db/repositories/sessions.js";
import { CREWDECK_SESSION_PREFIX, mergeContext, type AgentAdapter } from "./types.js";
import { shellQuote } from "./adapters/claude-code.js";

const execAsync = promisify(exec);

// List all tmux sessions whose names start with the crewdeck prefix
async function listCrewdeckTmuxSessions(): Promise<string[]> {
  try {
    const { stdout } = await execAsync("tmux list-sessions -F '#{session_name}'");
    return stdout
      .trim()
      .split("\n")
      .filter((name) => name.startsWith(CREWDECK_SESSION_PREFIX));
  } catch {
    // tmux not running or no sessions — not an error
    return [];
  }
}

// On startup: kill all lingering crewdeck tmux sessions and mark their DB records as error.
// These are orphans from a previous backend process that didn't shut down cleanly.
export async function cleanupOrphans(): Promise<void> {
  const tmuxSessions = await listCrewdeckTmuxSessions();
  if (tmuxSessions.length === 0) return;

  logger.info({ count: tmuxSessions.length }, "Found orphaned tmux sessions on startup");

  // Build a lookup of tmux_session_name → Session for running DB sessions
  const runningSessions = listRunningSessions();
  const sessionByName = new Map(
    runningSessions
      .filter((s) => s.tmux_session_name !== null)
      .map((s) => [s.tmux_session_name!, s])
  );

  for (const tmuxName of tmuxSessions) {
    try {
      await execAsync(`tmux kill-session -t ${shellQuote(tmuxName)}`);
    } catch {
      // Already gone
    }

    const session = sessionByName.get(tmuxName);
    if (session) {
      updateSession(session.id, { status: "error" });
      logger.info({ session_id: session.id, tmux_session: tmuxName }, "Marked orphaned session as error");
    } else {
      logger.info({ tmux_session: tmuxName }, "Killed orphaned tmux session (no DB record)");
    }
  }

  logger.info({ count: tmuxSessions.length }, "Orphan cleanup complete");
}

// On SIGTERM/SIGINT: capture output, gracefully exit each running session, update DB.
export async function gracefulShutdown(adapter: AgentAdapter): Promise<void> {
  const sessions = listRunningSessions();
  if (sessions.length === 0) return;

  logger.info({ count: sessions.length }, "Graceful shutdown: stopping active sessions");

  await Promise.all(
    sessions.map(async (session) => {
      if (!session.tmux_session_name) return;

      // Capture current output snapshot
      let output = "";
      try {
        output = await adapter.getOutput(session.tmux_session_name);
      } catch {
        // Output unavailable
      }

      // Save output snapshot to context
      updateSession(session.id, {
        context: mergeContext(session.context, { shutdown_output: output }),
      });

      // Kill the session (graceful then force)
      await adapter.kill(session.tmux_session_name);

      updateSession(session.id, { status: "completed" });
      logger.info({ session_id: session.id }, "Session stopped during shutdown");
    })
  );

  logger.info("Graceful shutdown complete");
}
