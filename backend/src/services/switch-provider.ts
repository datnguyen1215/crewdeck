import * as globalConfigRepo from "../db/repositories/global-config.js";
import { logger } from "../logger.js";

// Guard against concurrent provider switch requests to prevent duplicate cleanup intervals
let providerSwitchInProgress = false;

/**
 * Switch the LLM provider with proper PTY service lifecycle management.
 * Shuts down existing PTY sessions, updates config, then reinitializes.
 * Returns the new provider string, or throws on failure.
 */
export async function switchProvider(
  provider: "claude" | "glm",
): Promise<string> {
  if (providerSwitchInProgress) {
    throw Object.assign(new Error("Provider switch already in progress"), {
      status: 409,
    });
  }
  providerSwitchInProgress = true;

  const { shutdownPtyService, initPtyService } =
    await import("../orchestration/pty-service.js");

  try {
    // Order matters:
    // 1. Shutdown first to kill existing sessions and clear cleanup interval
    // 2. Update config so new sessions use the new provider
    // 3. Init last to start new cleanup interval
    await shutdownPtyService();
    globalConfigRepo.setProvider(provider);
    initPtyService();
    return globalConfigRepo.getProvider();
  } catch (err) {
    logger.error({ err }, "Failed to switch provider");
    // Always restart PTY service to ensure cleanup interval is running
    initPtyService();
    throw err;
  } finally {
    providerSwitchInProgress = false;
  }
}
