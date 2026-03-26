/**
 * VCS Provider Registry
 *
 * Central registry for VCS providers. Maps provider names to client instances.
 */
import type { VCSProvider, VCSProviderClient } from "./types.js";
import { GitHubClient } from "./github/client.js";
import { ValidationError } from "../middleware/errors.js";

const providers: Record<VCSProvider, VCSProviderClient> = {
  github: new GitHubClient(),
};

/**
 * Get a VCS provider client by name.
 */
export function getProvider(provider: VCSProvider): VCSProviderClient {
  return providers[provider];
}

/**
 * Get all registered provider clients.
 */
export function getAllProviders(): VCSProviderClient[] {
  return Object.values(providers);
}

/**
 * Parse a repository URL and return the provider name and repo info.
 * Tries each registered provider until one succeeds.
 */
export function parseRepoUrl(
  url: string,
): { provider: VCSProvider; owner: string; name: string } {
  for (const [providerName, client] of Object.entries(providers)) {
    try {
      const parsed = client.parseRepoUrl(url);
      return { provider: providerName as VCSProvider, ...parsed };
    } catch {
      continue;
    }
  }
  throw new ValidationError("Cannot parse repository URL");
}
