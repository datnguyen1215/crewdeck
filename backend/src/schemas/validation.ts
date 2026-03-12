import { z } from "zod";

export const CreateProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  max_concurrency: z.number().int().positive().optional(),
  max_review_rounds: z.number().int().nonnegative().optional(),
});

export const UpdateProjectSchema = CreateProjectSchema.partial().extend({
  orchestrator_session_id: z.string().nullable().optional(),
});

export const CreateRepoSchema = z.object({
  github_url: z.string().url(),
  local_path: z.string().min(1),
  default_branch: z.string().optional(),
});

export const UpdateCrewSchema = z.object({
  name: z.string().min(1),
});

export const CreateAgentSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  expertise: z.array(z.string()).optional(),
  system_prompt: z.string().min(1),
  can_review: z.boolean().optional(),
});

export const UpdateAgentSchema = CreateAgentSchema.partial();

export const CreateIssueSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  max_review_rounds: z.number().int().nonnegative().optional(),
  priority: z.number().int().optional(),
  created_by: z.string().optional(),
});

export const UpdateIssueSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  status: z.string().optional(),
  priority: z.number().int().optional(),
  assigned_agent_id: z.string().nullable().optional(),
  max_review_rounds: z.number().int().nonnegative().optional(),
  current_review_round: z.number().int().nonnegative().optional(),
  branch_name: z.string().nullable().optional(),
  worktree_path: z.string().nullable().optional(),
  base_branch: z.string().nullable().optional(),
  repo_id: z.string().nullable().optional(),
});

export const CreateCommentSchema = z.object({
  content: z.string().min(1),
  author_type: z.string().optional(),
  author_id: z.string().optional(),
});

export const CreateIssueAgentSchema = z.object({
  issue_id: z.string(),
  agent_id: z.string(),
  role: z.string().min(1),
  status: z.string().optional(),
  review_order: z.number().int().optional(),
  session_id: z.string().optional(),
});

export const UpdateIssueAgentSchema = z.object({
  status: z.string().optional(),
  review_order: z.number().int().optional(),
  session_id: z.string().nullable().optional(),
});

export const CreateIssuePRSchema = z.object({
  issue_id: z.string(),
  repo_id: z.string(),
  pr_number: z.number().int().positive(),
  pr_url: z.string().url(),
  status: z.string().optional(),
});

export const UpdateIssuePRSchema = z.object({
  status: z.string().optional(),
  pr_url: z.string().url().optional(),
});

export const CreateSessionSchema = z.object({
  project_id: z.string(),
  session_type: z.string().min(1),
  agent_id: z.string().optional(),
  issue_id: z.string().optional(),
  tmux_session_name: z.string().optional(),
  tmux_pane_id: z.string().optional(),
  status: z.string().optional(),
  context: z.unknown().optional(),
});

export const UpdateSessionSchema = z.object({
  session_type: z.string().min(1).optional(),
  agent_id: z.string().nullable().optional(),
  issue_id: z.string().nullable().optional(),
  tmux_session_name: z.string().nullable().optional(),
  tmux_pane_id: z.string().nullable().optional(),
  status: z.string().optional(),
  context: z.unknown().optional(),
});

export const CreateActivitySchema = z.object({
  project_id: z.string(),
  issue_id: z.string().optional(),
  actor_type: z.string().min(1),
  actor_id: z.string().optional(),
  action: z.string().min(1),
  details: z.unknown().optional(),
});
