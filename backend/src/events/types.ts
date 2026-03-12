// Issue, Comment, and IssuePR are redeclared here rather than imported from a shared types file
// because no shared entity types module exists yet. Once one is added (e.g. src/types/entities.ts),
// these should be replaced with imports or Pick<> aliases from that module to avoid drift.
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

export interface EventMap {
  "issue.created": { issue: Issue };
  "issue.updated": { issue_id: string; project_id: string; changes: Partial<Issue> };
  "issue.approved": { issue: Issue };
  "issue.status_changed": { issue_id: string; project_id: string; from: string; to: string };
  "issue.assigned": { issue_id: string; project_id: string; agent_id: string; agent_name: string };
  "comment.added": { comment: Comment; project_id: string };
  "session.started": {
    session_id: string;
    agent_id: string;
    issue_id: string;
    project_id: string;
    tmux_session_name: string;
  };
  "session.output": { session_id: string; project_id: string; output: string };
  "session.ended": { session_id: string; project_id: string; status: string };
  "agent.finished": {
    session_id: string;
    agent_id: string;
    issue_id: string;
    project_id: string;
    role: string;
  };
  "agent.error": { session_id: string; agent_id: string; issue_id: string; project_id: string; message?: string };
  "agent.needs_help": { session_id: string; agent_id: string; issue_id: string; project_id: string; message?: string };
  "agent.working": { agent_id: string; issue_id: string; project_id: string; session_id: string };
  "agent.idle": { agent_id: string; project_id: string };
  "agent.status_changed": { agent_id: string; issue_id: string; project_id: string; state: string };
  "pr.created": { issue_pr: IssuePR; project_id: string };
  "pr.status_changed": { pr_id: string; project_id: string; from: string; to: string };
  "orchestrator.decision": { project_id: string; action: string; details: unknown };
  "orchestrator.draft_issue": { issue: Issue; project_id: string };
  "review.completed": { issue_id: string; agent_id: string; project_id: string; verdict: string };
}
