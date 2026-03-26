/**
 * Captain: Split into Chat and Monitor services.
 *
 * Chat — interactive conversation with the user, streams responses via WebSocket.
 * Monitor — automated event-driven orchestration (issue lifecycle, agent dispatch, PR management).
 *
 * Both run independently per project.
 */
import {
  initChatService,
  shutdownChatService,
  startChatForProject,
  stopChatForProject,
} from "./captain/chat-service.js";
import {
  initMonitorService,
  shutdownMonitorService,
  startMonitorForProject,
  stopMonitorForProject,
} from "./captain/monitor-service.js";

/**
 * Start both Chat and Monitor for a project.
 */
export function startCaptainForProject(projectId: string): void {
  startChatForProject(projectId);
  startMonitorForProject(projectId);
}

/**
 * Stop both Chat and Monitor for a project.
 */
export function stopCaptainForProject(projectId: string): void {
  stopChatForProject(projectId);
  stopMonitorForProject(projectId);
}

/**
 * Initialize both services for all captain-enabled projects.
 */
export function initCaptain(): void {
  initChatService();
  initMonitorService();
}

/**
 * Shutdown both services.
 */
export function shutdownCaptain(): void {
  shutdownChatService();
  shutdownMonitorService();
}
