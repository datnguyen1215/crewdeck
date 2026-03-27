import { config } from "./config.js";
import { logger } from "./logger.js";
import { db } from "./db/index.js";
import { eventBus } from "./events/bus.js";
import { setupWebSocket, shutdownWebSocket } from "./websocket.js";
import { setupTerminalWs, shutdownTerminalWs } from "./terminal-ws.js";
import { initActivityLogger } from "./events/activity-logger.js";
import { initWorktreeCleanup } from "./events/worktree-cleanup.js";
import { initEventCommenter } from "./events/event-commenter.js";
import {
  initMentionHandler,
  shutdownMentionHandler,
} from "./orchestration/handler.js";
import { recoverOnStartup } from "./orchestration/recovery.js";
import { createApp } from "./app.js";
import { initPRDetector } from "./pr/detector.js";
import { startPRPoller, stopPRPoller } from "./pr/poller.js";
import { initCaptain, shutdownCaptain } from "./orchestration/captain.js";
import {
  initPtyService,
  shutdownPtyService,
} from "./orchestration/captain/pty-service.js";

const app = createApp();

async function main(): Promise<void> {
  initActivityLogger();
  initWorktreeCleanup();
  initEventCommenter();
  initMentionHandler();
  recoverOnStartup();

  // Initialize PR auto-detection from comments and polling
  initPRDetector();
  startPRPoller();

  // Initialize Captain auto-pilot orchestrator
  initCaptain();

  // Initialize PTY service for terminal sessions
  initPtyService();

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
    shutdownWebSocket(wss);
    shutdownTerminalWs();
    shutdownMentionHandler();
    shutdownCaptain();
    await shutdownPtyService();
    stopPRPoller();
    db.close();
    process.exit(0);
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
