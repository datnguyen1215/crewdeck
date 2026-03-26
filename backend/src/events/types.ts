import type {
  Issue,
  Comment,
  IssuePR,
  AgentRunStatus,
  Project,
} from "../types/entities.js";

export interface EventMap {
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
  // pr.status_changed: reserved for future PR webhook integration — not currently emitted
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
  // Monitor LLM agent events (automated orchestration)
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
  // Project settings changed
  "project.settings_changed": {
    project_id: string;
    changes: Partial<Project>;
  };
}
