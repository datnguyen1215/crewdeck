import { config } from "./config.js";
import { logger } from "./logger.js";
import { db } from "./db/index.js";
import { claudeCodeAdapter } from "./agent/adapters/claude-code.js";
import { ProcessMonitor } from "./agent/process-monitor.js";
import { cleanupOrphans, gracefulShutdown } from "./agent/orphan-cleanup.js";
import { eventBus } from "./events/bus.js";
import { setupWebSocket, shutdownWebSocket } from "./websocket.js";
import { initOrchestrator } from "./orchestrator/index.js";
import { createApp } from "./app.js";

const app = createApp({ corsOrigin: config.corsOrigin });

const processMonitor = new ProcessMonitor(claudeCodeAdapter);

async function main(): Promise<void> {
  // Run cleanup and start monitor before accepting connections to avoid
  // races between orphan cleanup, process monitoring, and incoming requests.
  await cleanupOrphans();
  processMonitor.start();
  initOrchestrator(claudeCodeAdapter);

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(config.port, config.host, () => {
      logger.info(`Server ready on port ${config.port}`);
      resolve(s);
    });
  });

  const wss = setupWebSocket(server, eventBus);

  async function shutdown() {
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
