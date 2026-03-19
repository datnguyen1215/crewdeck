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
  orchestrator_status: string;
}

export interface Repo {
  id: string;
  project_id: string;
  github_url: string;
  default_branch: string;
  created_at: string;
  updated_at: string;
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
  is_captain: boolean;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CrewWithAgents extends Crew {
  agents: (Agent & {
    current_issue: { id: string; title: string } | null;
  })[];
}

export interface Issue {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  assigned_agent_id: string | null;
  created_by: string;
  max_review_rounds: number | null;
  current_review_round: number;
  branch_name: string | null;
  worktree_path: string | null;
  base_branch: string;
  repo_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface IssueAgent {
  id: string;
  issue_id: string;
  agent_id: string;
  role: "worker" | "reviewer";
  status: string;
  review_order: number | null;
  agent: { id: string; name: string } | null;
}

export interface IssuePR {
  id: string;
  issue_id: string;
  pr_number: number;
  pr_url: string;
  status: string;
}

export interface IssueWithDetails extends Issue {
  assigned_agent: { id: string; name: string } | null;
  repo: { id: string; name: string } | null;
  comments: Comment[];
  activity_log: ActivityLog[];
  issue_agents: IssueAgent[];
  issue_prs: IssuePR[];
}

export interface Comment {
  id: string;
  issue_id: string;
  author_type: string;
  author_id: string | null;
  content: string;
  created_at: string;
}

export interface Session {
  id: string;
  project_id: string;
  session_type: string;
  agent_id: string | null;
  issue_id: string | null;
  tmux_session_name: string;
  tmux_pane_id: string | null;
  status: string;
  context: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
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

export interface CaptainMessage {
  id: string;
  project_id: string;
  author_type: string;
  author_id: string | null;
  content: string;
  context: Record<string, unknown> | null;
  created_at: string;
}
