/**
 * Captain: Auto-pilot orchestrator that manages the project automatically.
 *
 * This module is now a thin wrapper that delegates to the event-driven
 * Captain service in ./captain/service.ts
 */
import {
  initCaptainService,
  shutdownCaptainService,
} from "./captain/service.js";
export {
  startCaptainForProject,
  stopCaptainForProject,
} from "./captain/service.js";

/**
 * Initialize the Captain background service.
 */
export function initCaptain(): void {
  initCaptainService();
}

/**
 * Shutdown the Captain service.
 */
export function shutdownCaptain(): void {
  shutdownCaptainService();
}
