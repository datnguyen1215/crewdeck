export interface Project {
  id: string;
  name: string;
  description: string | null;
  auto_start: boolean;
  auto_merge: boolean;
  model: string;
  vcs_account_id: string | null;
  default_base_branch: string;
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
  active_runs: number;
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
  paused: boolean;
  created_at: string;
  updated_at: string;
}

export interface IssueDependencySummary {
  id: string;
  title: string;
  status: string;
}

export interface IssueWithRunningAgent extends Issue {
  running_agent_id: string | null;
  running_agent_status: string | null;
  dependencies: IssueDependencySummary[];
  dependents: IssueDependencySummary[];
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
  dependencies: IssueDependencySummary[];
  dependents: IssueDependencySummary[];
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
  issue_title?: string;
  project_name?: string;
  action: string;
  details: Record<string, unknown>;
  // Promoted from details in compact API responses
  from?: string;
  to?: string;
  pr_number?: number;
  exit_code?: number | null;
  created_at: string;
}

export interface VCSAccount {
  id: string;
  account_name: string;
  username: string;
  provider?: string;
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

export type MonitorMessageRole = "user" | "assistant";

export interface MonitorMessage {
  id: string;
  project_id: string;
  role: MonitorMessageRole;
  content: string;
  created_at: string;
}

export interface AgentConfig {
  id: string;
  agent_id: string;
  model: string | null;
}

export interface MonitorEntry {
  id: string;
  type: "event" | "thinking" | "message" | "tool_call" | "tool_result" | "rate_limit" | "result";
  content: string;
  timestamp: Date;
  toolName?: string;
  toolInput?: unknown;
  success?: boolean;
  costUsd?: number;
  durationMs?: number;
}

export interface CaptainStatus {
  status: "idle" | "receiving" | "thinking" | "executing";
  detail: string | null;
  pending_count: number;
  processing_since: string | null;
  processing_duration_ms: number | null;
}

export interface GlobalConfig {
  defaultModel: string;
  maxConcurrency: number;
  maxChainDepth: number;
  agentTimeoutMinutes: number;
}

export interface GlobalEnvironmentVariable {
  id: string;
  key: string;
  value: string;
  is_secret: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface ChatThread {
  id: string;
  project_id: string;
  title: string | null;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatThreadListItem extends ChatThread {
  last_message: string | null;
  message_count: number;
}

export interface ChatThreadDetail extends ChatThread {
  messages: ChatMessage[];
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system' | 'event' | 'tool';
  content: string;
  metadata: string | null;
  created_at: string;
}

export type ChatMessageEventType = 'thinking' | 'text' | 'tool_call' | 'tool_result' | 'system' | 'result';

export interface ChatMessageEvent {
  id: string;
  message_id: string;
  type: ChatMessageEventType;
  data: Record<string, unknown>;
  created_at: string;
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
  "issue.paused": {
    issue_id: string;
    project_id: string;
  };
  "issue.resumed": {
    issue_id: string;
    project_id: string;
  };
  "monitor.event_received": {
    project_id: string;
    event_type: string;
    description: string;
  };
  "monitor.thinking": { project_id: string; content?: string };
  "monitor.message": { project_id: string; content: string };
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
  "monitor.complete": { project_id: string; response: string };
  "monitor.rate_limit": { project_id: string; message: string };
  "monitor.result": {
    project_id: string;
    cost_usd?: number;
    duration_ms?: number;
    stop_reason?: string;
  };
  "chat.message": { project_id: string; thread_id: string; message_id: string; content: string };
  "chat.tool_call": { project_id: string; thread_id: string; message_id: string; tool_call_id: string; tool_name: string; tool_input: unknown };
  "chat.tool_result": { project_id: string; thread_id: string; message_id: string; tool_call_id: string; tool_name: string; result: unknown };
  "chat.thinking": { project_id: string; thread_id: string; message_id: string; content?: string };
  "chat.complete": { project_id: string; thread_id: string; message_id: string };
  "chat.error": { project_id: string; thread_id: string; error: string };
  "chat.session_expired": { project_id: string; thread_id: string };
  "chat.thread_updated": { project_id: string; thread_id: string; title: string };
  "project.settings_changed": { project_id: string; changes: Partial<Project> };
  "project.created": { project: Project };
  "project.deleted": { project_id: string };
}

// Subset of events broadcast to global (dashboard) WebSocket subscribers.
// Excludes chat events. run.event is high-frequency — consumers should
// update only the matching run card, not re-render the entire list.
export interface GlobalWsEventMap {
  "run.event": {
    agent_run_id: string;
    project_id: string;
    event_id: string;
    type: string;
    data: unknown;
    created_at: string;
  };
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
  };
  "issue.paused": { issue_id: string; project_id: string };
  "issue.resumed": { issue_id: string; project_id: string };
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
  "monitor.event_received": {
    project_id: string;
    event_type: string;
    description: string;
  };
  "monitor.thinking": { project_id: string; content?: string };
  "monitor.message": { project_id: string; content: string };
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
  "monitor.complete": { project_id: string; response: string };
  "monitor.rate_limit": { project_id: string; message: string };
  "monitor.result": {
    project_id: string;
    cost_usd?: number;
    duration_ms?: number;
    stop_reason?: string;
  };
  "project.settings_changed": { project_id: string; changes: Partial<Project> };
  "project.created": { project: Project };
  "project.deleted": { project_id: string };
}
