/**
 * Captain: Monitor service for automated orchestration.
 */
import {
  initMonitorService,
  shutdownMonitorService,
  startMonitorForProject,
  stopMonitorForProject,
} from "./captain/monitor-service.js";

export function startCaptainForProject(projectId: string): void {
  startMonitorForProject(projectId);
}

export function stopCaptainForProject(projectId: string): void {
  stopMonitorForProject(projectId);
}

export function initCaptain(): void {
  initMonitorService();
}

export function shutdownCaptain(): void {
  shutdownMonitorService();
}
