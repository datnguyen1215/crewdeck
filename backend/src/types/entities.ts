export interface VCSAccount {
  id: string;
  provider: string;
  account_name: string;
  username: string;
  token: string;
  ssh_private_key: string;
  created_at: string;
}

export interface CreateVCSAccountInput {
  provider?: string;
  account_name: string;
  username: string;
  token: string;
  ssh_private_key: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  auto_start: boolean;
  auto_merge: boolean;
  model: string;
  vcs_account_id: string | null;
  default_base_branch: string;
  captain_status: "idle" | "receiving" | "thinking" | "executing";
  captain_status_detail: string | null;
  captain_pending_count: number;
  captain_processing_since: string | null;
  created_at: string;
  updated_at: string;
}

export interface Repo {
  id: string;
  project_id: string;
  repo_url: string;
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
  /** Whether this agent can be dispatched via /dispatch command. Background services like Captain are not dispatchable. */
  dispatchable?: boolean;
}

export interface Issue {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: string;
  created_by: string;
  chain_depth: number;
  branch_name: string | null;
  worktree_path: string | null;
  base_branch: string | null;
  repo_id: string | null;
  agent_id: string | null;
  paused: boolean;
  created_at: string;
  updated_at: string;
}

export interface IssueWithRunningAgent extends Issue {
  running_agent_id: string | null;
  running_agent_status: string | null;
  dependencies?: IssueDependencySummary[];
  dependents?: IssueDependencySummary[];
}

export interface IssueDependency {
  id: string;
  issue_id: string;
  depends_on_issue_id: string;
  created_at: string;
}

export interface IssueDependencySummary {
  id: string;
  title: string;
  status: string;
}

export interface Comment {
  id: string;
  issue_id: string;
  author_type: string;
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

export type AgentRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timeout";

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

export interface GlobalEnvironmentVariable {
  id: string;
  key: string;
  value: string;
  is_secret: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateGlobalEnvironmentVariableInput {
  key: string;
  value: string;
  is_secret?: boolean;
}

export interface UpdateGlobalEnvironmentVariableInput {
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
  active_runs: number;
}

export interface IssueWithDetails extends Issue {
  comments: Comment[];
  issue_prs: IssuePR[];
  activity_log: ActivityLog[];
  repo: { id: string; name: string } | null;
  dependencies: IssueDependencySummary[];
  dependents: IssueDependencySummary[];
}

// Input types
export interface CreateProjectInput {
  name: string;
  description?: string;
  repo_url?: string;
  default_branch?: string;
  vcs_account_id?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  auto_start?: boolean;
  auto_merge?: boolean;
  vcs_account_id?: string | null;
  default_base_branch?: string;
}

export interface AgentConfig {
  id: string;
  agent_id: string;
  model: string | null;
}

export interface CreateRepoInput {
  repo_url: string;
  default_branch?: string;
}

export interface CreateIssueInput {
  title: string;
  description: string;
  status?: string;
  created_by?: string;
  agent_id?: string | null;
  base_branch?: string;
}

export interface UpdateIssueInput {
  title?: string;
  description?: string;
  status?: string;
  chain_depth?: number;
  branch_name?: string | null;
  worktree_path?: string | null;
  base_branch?: string | null;
  repo_id?: string | null;
  agent_id?: string | null;
  paused?: boolean;
}

export interface IssueFilters {
  status?: string[];
  created_by?: string;
  sort?: "created_at" | "updated_at";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface PaginatedIssues {
  issues: IssueWithRunningAgent[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateCommentInput {
  content: string;
  author_type?: string;
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
  created_at: string;
  updated_at: string;
}

export interface CreateKnowledgeInput {
  title: string;
  category: string;
  content: string;
  source?: string;
}

export interface UpdateKnowledgeInput {
  title?: string;
  category?: string;
  content?: string;
  source?: string | null;
}

// Monitor message types
export type MonitorMessageRole = "user" | "assistant";

export interface MonitorMessage {
  id: string;
  project_id: string;
  role: MonitorMessageRole;
  content: string;
  created_at: string;
}
