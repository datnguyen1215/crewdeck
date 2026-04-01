import { parseRepoUrl, getProvider } from "./registry.js";
import { getVCSAccount } from "../db/repositories/vcs-accounts.js";
import type { VCSRepoMetadata } from "./types.js";

/**
 * Resolve repository metadata from a VCS provider.
 * Falls back to URL-derived values for unauthenticated requests that fail
 * (e.g. rate-limited on a public repo).
 * If vcsAccountId is provided and the request fails, the error is surfaced.
 */
export async function resolveRepoMetadata(
  repoUrl: string,
  vcsAccountId?: string,
): Promise<VCSRepoMetadata> {
  const { provider, owner, name } = parseRepoUrl(repoUrl);
  const vcsClient = getProvider(provider);
  const token = vcsAccountId ? getVCSAccount(vcsAccountId)?.token : undefined;

  try {
    return await vcsClient.fetchRepoMetadata({ owner, name, token });
  } catch (err) {
    if (vcsAccountId) throw err;
    return { name, description: null, default_branch: "main" };
  }
}
