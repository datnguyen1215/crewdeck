/**
 * Captain: Monitor service for automated orchestration.
 *
 * Monitor — automated event-driven orchestration (issue lifecycle, agent dispatch, PR management).
 */
import {
  initMonitorService,
  shutdownMonitorService,
  startMonitorForProject,
  stopMonitorForProject,
} from "./captain/monitor-service.js";

/**
 * Start Monitor for a project.
 */
export function startCaptainForProject(projectId: string): void {
  startMonitorForProject(projectId);
}

/**
 * Stop Monitor for a project.
 */
export function stopCaptainForProject(projectId: string): void {
  stopMonitorForProject(projectId);
}

/**
 * Initialize monitor service for all captain-enabled projects.
 */
export function initCaptain(): void {
  initMonitorService();
}

/**
 * Shutdown monitor service.
 */
export function shutdownCaptain(): void {
  shutdownMonitorService();
}
