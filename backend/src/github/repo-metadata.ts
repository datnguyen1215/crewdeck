/** Fetch repository metadata from the GitHub API. */

export interface RepoMetadata {
  name: string;
  description: string | null;
  default_branch: string;
}

/**
 * Fetch repo metadata (name, description, default branch) from the GitHub API.
 * Works for public repos without a token, and private repos with one.
 */
export async function fetchRepoMetadata(
  owner: string,
  name: string,
  token?: string,
): Promise<RepoMetadata> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    { headers },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GitHub API error ${res.status} for ${owner}/${name}: ${body}`,
    );
  }

  return (await res.json()) as RepoMetadata;
}
