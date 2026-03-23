/**
 * Admiral: Auto-pilot orchestrator that manages the project automatically.
 *
 * This module is now a thin wrapper that delegates to the event-driven
 * Admiral service in ./admiral/service.ts
 */
import { initAdmiralService, shutdownAdmiralService } from "./admiral/service.js";
export { startAdmiralForProject, stopAdmiralForProject } from "./admiral/service.js";

/**
 * Initialize the Admiral background service.
 */
export function initAdmiral(): void {
  initAdmiralService();
}

/**
 * Shutdown the Admiral service.
 */
export function shutdownAdmiral(): void {
  shutdownAdmiralService();
}
