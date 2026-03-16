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
  max_review_rounds: number;
  orchestrator_session_id: string | null;
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

export interface Crew {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  crew_id: string;
  name: string;
  title: string;
  description: string | null;
  system_prompt: string;
  created_at: string;
  updated_at: string;
}

export interface Issue {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  assigned_agent_id: string | null;
  created_by: string;
  max_review_rounds: number | null;
  current_review_round: number;
  branch_name: string | null;
  worktree_path: string | null;
  base_branch: string | null;
  repo_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: string;
  issue_id: string;
  author_type: string;
  author_id: string | null;
  content: string;
  created_at: string;
}

export interface IssueAgent {
  id: string;
  issue_id: string;
  agent_id: string;
  role: string;
  status: string;
  review_order: number | null;
  review_round: number | null;
  session_id: string | null;
  created_at: string;
  updated_at: string;
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

export interface Session {
  id: string;
  project_id: string;
  session_type: string;
  agent_id: string | null;
  issue_id: string | null;
  tmux_session_name: string | null;
  tmux_pane_id: string | null;
  status: string;
  context: unknown;
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

// Composite types
export interface ProjectWithStats extends Project {
  repo_count: number;
  agent_count: number;
  issues: {
    open: number;
    in_progress: number;
    in_review: number;
    ready: number;
    done: number;
  };
  orchestrator_status: "none" | "active" | "error" | "idle";
}

export interface CrewWithAgents extends Crew {
  agents: Agent[];
}

export interface IssueWithDetails extends Issue {
  comments: Comment[];
  agents: IssueAgent[];
  prs: IssuePR[];
  activity: ActivityLog[];
}

// Input types
export interface CreateProjectInput {
  name: string;
  description?: string;
  max_concurrency?: number;
  max_review_rounds?: number;
  github_url?: string;
  default_branch?: string;
  github_account_id?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  max_concurrency?: number;
  max_review_rounds?: number;
  orchestrator_session_id?: string | null;
  github_account_id?: string | null;
}

export interface CreateRepoInput {
  github_url: string;
  default_branch?: string;
}

export interface UpdateCrewInput {
  name: string;
}

export interface CreateAgentInput {
  name: string;
  title: string;
  description?: string;
  system_prompt: string;
}

export interface UpdateAgentInput {
  name?: string;
  title?: string;
  description?: string;
  system_prompt?: string;
}

export interface CreateIssueInput {
  title: string;
  description: string;
  status?: string;
  max_review_rounds?: number;
  priority?: number;
  created_by?: string;
}

export interface UpdateIssueInput {
  title?: string;
  description?: string;
  status?: string;
  priority?: number;
  assigned_agent_id?: string | null;
  max_review_rounds?: number;
  current_review_round?: number | null;
  branch_name?: string | null;
  worktree_path?: string | null;
  base_branch?: string | null;
  repo_id?: string | null;
}

export interface IssueFilters {
  status?: string[];
  assigned_agent_id?: string;
  created_by?: string;
  sort?: "priority" | "created_at" | "updated_at";
  order?: "asc" | "desc";
}

export interface CreateCommentInput {
  content: string;
  author_type?: string;
  author_id?: string;
}

export interface CreateIssueAgentInput {
  issue_id: string;
  agent_id: string;
  role: string;
  status?: string;
  review_order?: number;
  review_round?: number;
  session_id?: string;
}

export interface UpdateIssueAgentInput {
  status?: string;
  review_order?: number;
  review_round?: number;
  session_id?: string | null;
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

export interface CreateSessionInput {
  project_id: string;
  session_type: string;
  agent_id?: string;
  issue_id?: string;
  tmux_session_name?: string;
  tmux_pane_id?: string;
  status?: string;
  context?: unknown;
}

export interface UpdateSessionInput {
  session_type?: string;
  agent_id?: string | null;
  issue_id?: string | null;
  tmux_session_name?: string | null;
  tmux_pane_id?: string | null;
  status?: string;
  context?: unknown;
}

export interface SessionFilters {
  status?: string;
  session_type?: string;
  issue_id?: string;
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
