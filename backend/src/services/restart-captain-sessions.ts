import { logger } from "../logger.js";

let restartInProgress = false;

/**
 * Restart all active Captain sessions to pick up configuration changes.
 * Reuses the PTY service shutdown/init cycle.
 */
export async function restartCaptainSessions(): Promise<void> {
  if (restartInProgress) {
    throw Object.assign(new Error("Restart already in progress"), {
      status: 409,
    });
  }
  restartInProgress = true;

  const { shutdownPtyService, initPtyService } = await import(
    "../orchestration/pty-service.js"
  );

  try {
    await shutdownPtyService();
    initPtyService();
  } catch (err) {
    logger.error({ err }, "Failed to restart Captain sessions");
    initPtyService();
    throw err;
  } finally {
    restartInProgress = false;
  }
}
