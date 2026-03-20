import { config } from "./config.js";
import { logger } from "./logger.js";
import { db } from "./db/index.js";
import { eventBus } from "./events/bus.js";
import { setupWebSocket, shutdownWebSocket } from "./websocket.js";
import { initActivityLogger } from "./events/activity-logger.js";
import { initMentionHandler, shutdownMentionHandler, recoverOnStartup } from "./orchestration/handler.js";
import { createApp } from "./app.js";
import { initPRDetector } from "./pr/detector.js";
import { startPRPoller, stopPRPoller } from "./pr/poller.js";

const app = createApp({ corsOrigin: config.corsOrigin });

async function main(): Promise<void> {
  initActivityLogger();
  initMentionHandler();
  recoverOnStartup();

  // Initialize PR auto-detection from comments and polling
  initPRDetector();
  startPRPoller();

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(config.port, config.host, () => {
      logger.info(`Server ready on port ${config.port}`);
      resolve(s);
    });
  });

  const wss = setupWebSocket(server, eventBus);

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "", "http://localhost").pathname;
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) =>
        wss.emit("connection", ws, req),
      );
    } else {
      socket.destroy();
    }
  });

  async function shutdown() {
    shutdownWebSocket(wss);
    shutdownMentionHandler();
    stopPRPoller();
    db.close();
    process.exit(0);
  }
  process.on("SIGTERM", () => { void shutdown(); });
  process.on("SIGINT", () => { void shutdown(); });
}

main().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
