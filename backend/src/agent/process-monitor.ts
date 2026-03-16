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
  // Track last captured output per session for diff-based streaming
  private lastOutput = new Map<string, string>();

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

        // Capture output while session may still exist — after isAlive returns
        // false the tmux pane is gone and capture-pane will fail.
        let lastOutput = "";
        try {
          lastOutput = await this.adapter.getOutput(session.tmux_session_name);
        } catch {
          // Output unavailable
        }

        const alive = await this.adapter.isAlive(session.tmux_session_name);
        if (alive) {
          this.finished.delete(session.id);

          // Stream output diff to frontend
          const prev = this.lastOutput.get(session.id) ?? "";
          if (lastOutput && lastOutput !== prev) {
            // Send only the new portion of output
            const newContent = lastOutput.startsWith(prev)
              ? lastOutput.slice(prev.length)
              : lastOutput;
            if (newContent) {
              eventBus.emit("session.output", {
                session_id: session.id,
                project_id: session.project_id,
                output: newContent,
              });
            }
            this.lastOutput.set(session.id, lastOutput);
          }
          return;
        }

        // Check stopped just before mutating DB — if shutdown started while we
        // were awaiting above, gracefulShutdown owns the final status update.
        if (this.stopped) {
          this.finished.delete(session.id);
          return;
        }

        try {
          updateSession(session.id, {
            status: "completed",
            context: mergeContext(session.context, { final_output: lastOutput }),
          });

          // Send final output diff before session.ended
          const prev = this.lastOutput.get(session.id) ?? "";
          if (lastOutput && lastOutput !== prev) {
            const newContent = lastOutput.startsWith(prev)
              ? lastOutput.slice(prev.length)
              : lastOutput;
            if (newContent) {
              eventBus.emit("session.output", {
                session_id: session.id,
                project_id: session.project_id,
                output: newContent,
              });
            }
          }
          this.lastOutput.delete(session.id);

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
    // Clean up stale output tracking for sessions no longer running
    for (const id of this.lastOutput.keys()) {
      if (!activeIds.has(id)) this.lastOutput.delete(id);
    }
  }
}
