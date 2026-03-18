import { exec } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../logger.js";
import { listRunningSessions, updateSession } from "../db/repositories/sessions.js";
import { CREWDECK_SESSION_PREFIX, mergeContext, type AgentAdapter } from "./types.js";
import { shellQuote } from "./shell.js";

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

// On startup: check liveness of running sessions. Sessions with live tmux
// processes are left alone. DB sessions whose tmux has died are marked as error.
// Orphaned tmux sessions (no matching DB record) are killed.
// Returns issue IDs that were in_progress but lost their session, so the
// captain can be notified to respawn them.
export async function cleanupOrphans(): Promise<string[]> {
  const tmuxSessions = await listCrewdeckTmuxSessions();
  const liveTmuxNames = new Set(tmuxSessions);

  const runningSessions = listRunningSessions();
  const dbTmuxNames = new Set(
    runningSessions.map((s) => s.tmux_session_name).filter(Boolean),
  );

  // Kill tmux sessions that have no matching DB record (truly orphaned)
  let tmuxKilled = 0;
  for (const tmuxName of tmuxSessions) {
    if (!dbTmuxNames.has(tmuxName)) {
      try {
        await execAsync(`tmux kill-session -t ${shellQuote(tmuxName)}`);
        logger.info({ tmux_session: tmuxName }, "Killed orphaned tmux session (no DB record)");
        tmuxKilled++;
      } catch {
        // Already gone
      }
    }
  }

  // Check each DB session: if its tmux is still alive, leave it alone.
  // If the tmux is gone, mark the DB session as error.
  const orphanedIssueIds: string[] = [];
  let dbCleaned = 0;
  for (const session of runningSessions) {
    const isAlive = session.tmux_session_name && liveTmuxNames.has(session.tmux_session_name);
    if (isAlive) {
      logger.info(
        { session_id: session.id, tmux: session.tmux_session_name },
        "Session still alive, keeping"
      );
      continue;
    }
    updateSession(session.id, { status: "error" });
    if (session.issue_id) orphanedIssueIds.push(session.issue_id);
    dbCleaned++;
    logger.info(
      { session_id: session.id },
      "Marked dead session as error"
    );
  }

  if (tmuxKilled || dbCleaned) {
    logger.info(
      { tmux_killed: tmuxKilled, db_cleaned: dbCleaned, orphaned_issues: orphanedIssueIds.length },
      "Orphan cleanup complete"
    );
  }

  return orphanedIssueIds;
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
