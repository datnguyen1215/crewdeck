import { config } from "../config.js";
import { logger } from "../logger.js";
import { listRunningSessions, updateSession } from "../db/repositories/sessions.js";
import { eventBus } from "../events/bus.js";
import { mergeContext, type AgentAdapter } from "./types.js";

export class ProcessMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  // Track sessions already marked finished to avoid duplicate events
  private finished = new Set<string>();

  constructor(private readonly adapter: AgentAdapter) {}

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      this.tick().catch((err: unknown) => {
        logger.error({ err }, "Process monitor tick failed");
      });
    }, config.processMonitorInterval);
    logger.info("Process monitor started");
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info("Process monitor stopped");
  }

  private async tick(): Promise<void> {
    const sessions = listRunningSessions();

    await Promise.all(
      sessions.map(async (session) => {
        if (this.finished.has(session.id)) return;
        if (!session.tmux_session_name) return;

        // Mark finished immediately (before any await) to prevent duplicate events
        // if overlapping ticks both observe the session as dead.
        this.finished.add(session.id);

        const alive = await this.adapter.isAlive(session.tmux_session_name);
        if (alive) {
          // Still running — undo the premature mark so we check again next tick.
          this.finished.delete(session.id);
          return;
        }

        // If the monitor was stopped (shutdown in progress), bail out —
        // gracefulShutdown owns the final status update for these sessions.
        if (this.stopped) {
          this.finished.delete(session.id);
          return;
        }

        // Capture final output before marking complete
        let finalOutput = "";
        try {
          finalOutput = await this.adapter.getOutput(session.tmux_session_name);
        } catch {
          // Output unavailable — session already gone
        }

        try {
          updateSession(session.id, {
            status: "completed",
            context: mergeContext(session.context, { final_output: finalOutput }),
          });

          eventBus.emit("session.ended", {
            session_id: session.id,
            project_id: session.project_id,
            status: "completed",
          });

          if (session.agent_id && session.issue_id) {
            eventBus.emit("agent.finished", {
              session_id: session.id,
              agent_id: session.agent_id,
              issue_id: session.issue_id,
              project_id: session.project_id,
              role: session.session_type,
            });
          }

          logger.info({ session_id: session.id }, "Process monitor detected dead session");
        } catch (err: unknown) {
          // DB or event error — remove from finished so the next tick retries
          this.finished.delete(session.id);
          logger.error({ err, session_id: session.id }, "Failed to mark session as completed");
        }
      })
    );

    // Evict IDs that are no longer returned by listRunningSessions — once a session
    // leaves the running set it can never reappear, so keeping the ID is dead weight.
    const activeIds = new Set(sessions.map((s) => s.id));
    for (const id of this.finished) {
      if (!activeIds.has(id)) this.finished.delete(id);
    }
  }
}
