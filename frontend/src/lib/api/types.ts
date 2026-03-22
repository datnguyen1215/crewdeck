export interface Project {
  id: string;
  name: string;
  description: string | null;
  max_concurrency: number;
  github_account_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithStats extends Project {
  repo_count: number;
  issues: {
    open: number;
    in_progress: number;
    pr_created: number;
    done: number;
  };
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
}

export interface Issue {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
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

export interface IssueWithDetails extends Issue {
  repo: { id: string; name: string } | null;
  comments: Comment[];
  issue_prs: IssuePR[];
  activity_log: ActivityLog[];
}

export interface Comment {
  id: string;
  issue_id: string;
  author_type: string;
  author_id: string | null;
  content: string;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  project_id: string;
  issue_id: string | null;
  actor_type: string;
  actor_id: string | null;
  actor_name?: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface GitHubAccount {
  id: string;
  account_name: string;
  github_username: string;
  scopes: string | null;
  created_at: string;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface DeviceCodePollResponse {
  id?: string;
  account_name?: string;
  github_username?: string;
  scopes?: string | null;
  created_at?: string;
  status?: string;
  error?: string;
  error_description?: string;
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

export type AgentRunStatus = "queued" | "running" | "completed" | "failed" | "timeout";

export interface AgentRun {
  id: string;
  project_id: string;
  issue_id: string;
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

export interface ProjectKnowledge {
  id: string;
  project_id: string;
  title: string;
  category: string;
  content: string;
  source: 'user' | 'librarian';
  agents: string[];
  created_at: string;
  updated_at: string;
}

export interface LibrarianStatus {
  status: AgentRunStatus | null;
  started_at: string | null;
  completed_at: string | null;
}
