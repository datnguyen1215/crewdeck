export interface Project {
  id: string;
  name: string;
  description: string | null;
  max_concurrency: number;
  max_chain_depth: number;
  agent_timeout_minutes: number;
  auto_start: boolean;
  auto_merge: boolean;
  model: string;
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
    pr_conflict: number;
    pr_failed_actions: number;
    pr_ready_to_merge: number;
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
  created_at: string;
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

export interface ActiveRun extends AgentRun {
  agent_name: string;
  agent_title: string | null;
  issue_title: string | null;
  events: AgentRunEvent[];
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

export interface LibrarianStatus {
  status: AgentRunStatus | null;
  started_at: string | null;
  completed_at: string | null;
}

// Chat session types
export type ChatSessionStatus = "active" | "archived";

export interface ChatSession {
  id: string;
  project_id: string;
  title: string | null;
  summary: string | null;
  status: ChatSessionStatus;
  created_at: string;
  updated_at: string;
}

export type ChatMessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  project_id: string;
  session_id: string | null;
  role: ChatMessageRole;
  content: string;
  images: string[] | null;
  created_at: string;
}

export interface AgentConfig {
  id: string;
  project_id: string;
  agent_id: string;
  model: string | null;
}

export interface MonitorEntry {
  id: string;
  type: "event" | "thinking" | "message" | "tool_call" | "tool_result";
  content: string;
  timestamp: Date;
  toolName?: string;
  toolInput?: unknown;
  success?: boolean;
}

// WebSocket event payload map — mirrors backend EventMap (events/types.ts)
// but only includes events the frontend receives (excludes backend-only events)
export interface WsEventMap {
  "issue.created": { issue: Issue };
  "issue.updated": {
    issue_id: string;
    project_id: string;
    changes: Partial<Issue>;
  };
  "issue.status_changed": {
    issue_id: string;
    project_id: string;
    from: string;
    to: string;
    actor_type?: "user" | "agent" | "system";
    actor_id?: string;
  };
  "comment.added": { comment: Comment; project_id: string };
  "comment.updated": { comment: Comment; project_id: string };
  "comment.deleted": {
    comment_id: string;
    issue_id: string;
    project_id: string;
  };
  "pr.created": { issue_pr: IssuePR; project_id: string };
  "pr.status_changed": {
    pr_id: string;
    project_id: string;
    from: string;
    to: string;
  };
  "mention.spawned": {
    project_id: string;
    issue_id: string;
    agent_id: string;
    agent_name?: string;
    issue_title?: string;
    pid: number;
  };
  "mention.completed": {
    project_id: string;
    issue_id: string | null;
    agent_id: string;
    agent_name?: string;
    issue_title?: string;
    exit_code: number;
  };
  "mention.error": {
    project_id: string;
    issue_id: string;
    agent_id: string;
    agent_name?: string;
    issue_title?: string;
    message: string;
  };
  "mention.chain_depth_reached": {
    project_id: string;
    issue_id: string;
    issue_title?: string;
  };
  "dispatch.queued": {
    project_id: string;
    issue_id: string;
    agent_id: string;
    position: number;
  };
  "dispatch.dequeued": {
    project_id: string;
    issue_id: string;
    agent_id: string;
  };
  "run.started": {
    agent_run_id: string;
    project_id: string;
    issue_id: string | null;
    agent_id: string;
    status: AgentRunStatus;
    started_at: string | null;
  };
  "run.event": {
    agent_run_id: string;
    project_id: string;
    event_id: string;
    type: string;
    data: unknown;
    created_at: string;
  };
  "run.completed": {
    agent_run_id: string;
    project_id: string;
    issue_id: string | null;
    agent_id: string;
    status: AgentRunStatus;
    exit_code: number | null;
    cost_usd: number | null;
    duration_ms: number | null;
    completed_at: string;
  };
  "chat.stream": {
    project_id: string;
    token: string;
  };
  "chat.complete": {
    project_id: string;
    message_id: string | null;
  };
  "captain.thinking": {
    project_id: string;
  };
  "captain.message": {
    project_id: string;
    content: string;
  };
  "captain.complete": {
    project_id: string;
    response: string;
  };
  "captain.chat.chunk": {
    project_id: string;
    session_id: string;
    text: string;
  };
  "captain.chat.tool_call": {
    project_id: string;
    session_id: string;
    tool_name: string;
    tool_input: unknown;
  };
  "captain.chat.tool_result": {
    project_id: string;
    session_id: string;
    tool_name: string;
    result: unknown;
  };
  "captain.chat.complete": {
    project_id: string;
    session_id: string;
    message_id: string;
  };
  "monitor.event_received": {
    project_id: string;
    event_type: string;
    description: string;
  };
  "monitor.thinking": {
    project_id: string;
  };
  "monitor.message": {
    project_id: string;
    content: string;
  };
  "monitor.tool_call": {
    project_id: string;
    tool_name: string;
    tool_input: unknown;
  };
  "monitor.tool_result": {
    project_id: string;
    tool_name: string;
    result: unknown;
  };
  "monitor.complete": {
    project_id: string;
    response: string;
  };
}
