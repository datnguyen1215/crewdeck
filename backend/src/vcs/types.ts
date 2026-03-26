/**
 * VCS Provider Interface
 *
 * Abstraction layer for version control systems (GitHub, GitLab, etc.).
 * All VCS-specific logic should be behind this interface.
 */

export type VCSProvider = "github";

export interface VCSRepoMetadata {
  name: string;
  description: string | null;
  default_branch: string;
}

export interface VCSPRMetadata {
  number: number;
  url: string;
}

export interface VCSPRStatus {
  state: "open" | "merged" | "closed";
  mergeable: boolean | null;
  head_sha: string;
}

export interface VCSCIStatus {
  result: "pass" | "fail" | "pending";
}

export interface ParsedPRUrl {
  owner: string;
  name: string;
  prNumber: number;
  url: string;
}

export interface CreatePROpts {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
  token: string;
}

export interface MergePROpts {
  owner: string;
  repo: string;
  prNumber: number;
  token: string;
}

export interface DeleteBranchOpts {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export interface FetchPRStatusOpts {
  owner: string;
  repo: string;
  prNumber: number;
  token: string;
}

export interface FetchCIStatusOpts {
  owner: string;
  repo: string;
  ref: string;
  token: string;
}

export interface FetchRepoMetadataOpts {
  owner: string;
  name: string;
  token?: string;
}

/**
 * VCS Provider Client Interface
 *
 * Each VCS platform implements this interface to provide platform-specific operations.
 */
export interface VCSProviderClient {
  // Repository URL parsing and conversion
  parseRepoUrl(url: string): { owner: string; name: string };
  toSshUrl(owner: string, name: string): string;

  // Repository metadata
  fetchRepoMetadata(opts: FetchRepoMetadataOpts): Promise<VCSRepoMetadata>;

  // Pull request operations
  createPR(opts: CreatePROpts): Promise<VCSPRMetadata>;
  mergePR(opts: MergePROpts): Promise<{ success: boolean; message: string }>;
  deleteBranch(opts: DeleteBranchOpts): Promise<void>;

  // Status queries
  fetchPRStatus(opts: FetchPRStatusOpts): Promise<VCSPRStatus | null>;
  fetchCIStatus(opts: FetchCIStatusOpts): Promise<VCSCIStatus>;

  // URL detection
  parsePRUrls(content: string): ParsedPRUrl[];
}
