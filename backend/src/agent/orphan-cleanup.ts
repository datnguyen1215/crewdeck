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
// Also mark any DB sessions still in "running" whose tmux session no longer exists.
// These are orphans from a previous backend process that didn't shut down cleanly.
export async function cleanupOrphans(): Promise<void> {
  const tmuxSessions = await listCrewdeckTmuxSessions();
  const liveTmuxNames = new Set(tmuxSessions);

  // Kill all lingering crewdeck tmux sessions
  for (const tmuxName of tmuxSessions) {
    try {
      await execAsync(`tmux kill-session -t ${shellQuote(tmuxName)}`);
      logger.info({ tmux_session: tmuxName }, "Killed orphaned tmux session");
    } catch {
      // Already gone
    }
  }

  // Mark all DB sessions in "running" state as error — whether or not their
  // tmux session was still alive. If the previous backend crashed, some DB
  // sessions may have no tmux counterpart at all.
  const runningSessions = listRunningSessions();
  for (const session of runningSessions) {
    updateSession(session.id, { status: "error" });
    const hadTmux = session.tmux_session_name && liveTmuxNames.has(session.tmux_session_name);
    logger.info(
      { session_id: session.id, had_tmux: !!hadTmux },
      "Marked orphaned session as error"
    );
  }

  if (tmuxSessions.length || runningSessions.length) {
    logger.info(
      { tmux_killed: tmuxSessions.length, db_cleaned: runningSessions.length },
      "Orphan cleanup complete"
    );
  }
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

      // Kill the session (graceful then force)
      await adapter.kill(session.tmux_session_name);

      updateSession(session.id, {
        status: "error",
        context: mergeContext(session.context, { shutdown_output: output }),
      });
      logger.info({ session_id: session.id }, "Session stopped during shutdown");
    })
  );

  logger.info("Graceful shutdown complete");
}
