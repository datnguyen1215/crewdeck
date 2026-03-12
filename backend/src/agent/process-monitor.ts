import { config } from "../config.js";
import { logger } from "../logger.js";
import { listRunningSessions, updateSession } from "../db/repositories/sessions.js";
import { eventBus } from "../events/bus.js";
import type { AgentAdapter } from "./types.js";

export class ProcessMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  // Track sessions already marked finished to avoid duplicate events
  private finished = new Set<string>();

  constructor(private readonly adapter: AgentAdapter) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err: unknown) => {
        logger.error({ err }, "Process monitor tick failed");
      });
    }, config.processMonitorInterval);
    logger.info("Process monitor started");
  }

  stop(): void {
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

        const alive = await this.adapter.isAlive(session.tmux_session_name);
        if (alive) return;

        this.finished.add(session.id);

        // Capture final output before marking complete
        let finalOutput = "";
        try {
          finalOutput = await this.adapter.getOutput(session.tmux_session_name);
        } catch {
          // Output unavailable — session already gone
        }

        updateSession(session.id, {
          status: "completed",
          context: {
            ...(typeof session.context === "object" && session.context !== null
              ? (session.context as Record<string, unknown>)
              : {}),
            final_output: finalOutput,
          },
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
      })
    );
  }
}
