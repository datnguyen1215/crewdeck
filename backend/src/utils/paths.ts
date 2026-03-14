import { config } from "../config.js";

/**
 * Translate a host path to a container path.
 * When CREWDECK_REPOS_HOST_PATH and CREWDECK_REPOS_CONTAINER_PATH differ,
 * replaces the host prefix with the container prefix.
 * No-op when both are the same or unset (bare-metal mode).
 */
export function toContainerPath(hostPath: string): string {
  const { reposHostPath, reposContainerPath } = config;
  if (!reposHostPath || !reposContainerPath) return hostPath;
  if (reposHostPath === reposContainerPath) return hostPath;
  if (!hostPath.startsWith(reposHostPath)) return hostPath;
  const rest = hostPath.slice(reposHostPath.length);
  if (rest !== "" && !rest.startsWith("/")) return hostPath;
  return reposContainerPath + rest;
}
