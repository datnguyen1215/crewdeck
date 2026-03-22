export interface GitHubAccount {
  id: string;
  account_name: string;
  github_username: string;
  oauth_token: string;
  scopes: string | null;
  created_at: string;
}

export interface CreateGitHubAccountInput {
  account_name: string;
  github_username: string;
  oauth_token: string;
  scopes?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  max_concurrency: number;
  admiral_enabled: boolean;
  github_account_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Repo {
  id: string;
  project_id: string;
  github_url: string;
  name: string;
  owner: string;
  local_path: string;
  default_branch: string;
  created_at: string;
}

export interface Agent {
  id: string;
  name: string;
  title: string;
  description: string | null;
  system_prompt: string;
  /** Whether this agent can be dispatched via /dispatch command. Background services like Admiral are not dispatchable. */
  dispatchable?: boolean;
}

export interface Issue {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  created_by: string;
  chain_depth: number;
  branch_name: string | null;
  worktree_path: string | null;
  base_branch: string | null;
  repo_id: string | null;
  agent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface IssueWithRunningAgent extends Issue {
  running_agent_id: string | null;
  running_agent_status: string | null;
}

export interface Comment {
  id: string;
  issue_id: string;
  author_type: string;
  author_id: string | null;
  content: string;
  created_at: string;
}

export interface IssuePR {
  id: string;
  issue_id: string;
  repo_id: string;
  pr_number: number;
  pr_url: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ActivityLog {
  id: string;
  project_id: string;
  issue_id: string | null;
  actor_type: string;
  actor_id: string | null;
  action: string;
  details: unknown;
  created_at: string;
}

export type AgentRunStatus = "queued" | "running" | "completed" | "failed" | "timeout";

export interface AgentRun {
  id: string;
  project_id: string;
  issue_id: string | null;
  agent_id: string;
  pid: number | null;
  status: AgentRunStatus;
  exit_code: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export type AgentRunEventType = string;

export interface AgentRunEvent {
  id: string;
  agent_run_id: string;
  type: AgentRunEventType;
  data: unknown;
  created_at: string;
}

export interface AgentRunWithEvents extends AgentRun {
  events: AgentRunEvent[];
}

export interface EnvironmentVariable {
  id: string;
  project_id: string;
  key: string;
  value: string;
  is_secret: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateEnvironmentVariableInput {
  key: string;
  value: string;
  is_secret?: boolean;
}

export interface UpdateEnvironmentVariableInput {
  key?: string;
  value?: string;
  is_secret?: boolean;
}

// Composite types
export interface ProjectWithStats extends Project {
  repo_count: number;
  issues: {
    open: number;
    in_progress: number;
    pr_created: number;
    pr_conflict: number;
    pr_failed_actions: number;
    pr_ready_to_merge: number;
    done: number;
  };
}

export interface IssueWithDetails extends Issue {
  comments: Comment[];
  issue_prs: IssuePR[];
  activity_log: ActivityLog[];
  repo: { id: string; name: string } | null;
}

// Input types
export interface CreateProjectInput {
  name: string;
  description?: string;
  max_concurrency?: number;
  github_url?: string;
  default_branch?: string;
  github_account_id?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  max_concurrency?: number;
  admiral_enabled?: boolean;
  github_account_id?: string | null;
}

export interface CreateRepoInput {
  github_url: string;
  default_branch?: string;
}


export interface CreateIssueInput {
  title: string;
  description: string;
  status?: string;
  priority?: number;
  created_by?: string;
  agent_id?: string | null;
}

export interface UpdateIssueInput {
  title?: string;
  description?: string;
  status?: string;
  priority?: number;
  chain_depth?: number;
  branch_name?: string | null;
  worktree_path?: string | null;
  base_branch?: string | null;
  repo_id?: string | null;
  agent_id?: string | null;
}

export interface IssueFilters {
  status?: string[];
  created_by?: string;
  sort?: "priority" | "created_at" | "updated_at";
  order?: "asc" | "desc";
}

export interface CreateCommentInput {
  content: string;
  author_type?: string;
  author_id?: string;
}

export interface CreateIssuePRInput {
  issue_id: string;
  repo_id: string;
  pr_number: number;
  pr_url: string;
  status?: string;
}

export interface UpdateIssuePRInput {
  status?: string;
  pr_url?: string;
}

export interface CreateActivityInput {
  project_id: string;
  issue_id?: string;
  actor_type: string;
  actor_id?: string;
  action: string;
  details?: unknown;
}

export interface ActivityFilters {
  issue_id?: string;
  actor_type?: string;
  action?: string;
  since?: string;
  limit?: number;
  offset?: number;
}

export interface ProjectKnowledge {
  id: string;
  project_id: string;
  title: string;
  category: string;
  content: string;
  source: string | null;
  agent_ids: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface CreateKnowledgeInput {
  title: string;
  category: string;
  content: string;
  source?: string;
  agent_ids?: string[] | null;
}

export interface UpdateKnowledgeInput {
  title?: string;
  category?: string;
  content?: string;
  source?: string | null;
  agent_ids?: string[] | null;
}
