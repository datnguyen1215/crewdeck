import { config } from "./config.js";
import { logger } from "./logger.js";
import { db } from "./db/index.js";
import { claudeCodeAdapter } from "./agent/adapters/claude-code.js";
import { ProcessMonitor } from "./agent/process-monitor.js";
import { cleanupOrphans, gracefulShutdown } from "./agent/orphan-cleanup.js";
import { eventBus } from "./events/bus.js";
import { setupWebSocket, shutdownWebSocket } from "./websocket.js";
import { setupTerminalWs, shutdownTerminalWs } from "./terminal-ws.js";
import { initOrchestrator } from "./orchestrator/index.js";
import { initActivityLogger } from "./events/activity-logger.js";
import { createApp } from "./app.js";

const app = createApp({ corsOrigin: config.corsOrigin });

const processMonitor = new ProcessMonitor(claudeCodeAdapter);

async function main(): Promise<void> {
  // Run cleanup and start monitor before accepting connections to avoid
  // races between orphan cleanup, process monitoring, and incoming requests.
  const orphanedIssueIds = await cleanupOrphans();
  processMonitor.start();
  initActivityLogger();
  const orchestrator = initOrchestrator(claudeCodeAdapter);
  orchestrator.recoverCaptainSessions();
  // Start captain sessions for all projects in the background.
  // After captains are up, notify them of orphaned issues so they can respawn.
  orchestrator.startAllCaptains().then(() => {
    if (orphanedIssueIds.length > 0) {
      orchestrator.notifyOrphanedIssues(orphanedIssueIds);
    }
  }).catch((err) => {
    logger.error({ err }, "Failed to auto-start captain sessions");
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(config.port, config.host, () => {
      logger.info(`Server ready on port ${config.port}`);
      resolve(s);
    });
  });

  const wss = setupWebSocket(server, eventBus);
  const terminalWss = setupTerminalWs(server);

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "", "http://localhost").pathname;
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) =>
        wss.emit("connection", ws, req),
      );
    } else if (pathname === "/terminal-ws") {
      terminalWss.handleUpgrade(req, socket, head, (ws) =>
        terminalWss.emit("connection", ws, req),
      );
    } else {
      socket.destroy();
    }
  });

  async function shutdown() {
    shutdownTerminalWs();
    shutdownWebSocket(wss);
    processMonitor.stop();
    try {
      await gracefulShutdown(claudeCodeAdapter);
    } finally {
      db.close();
      process.exit(0);
    }
  }
  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });
}

main().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
