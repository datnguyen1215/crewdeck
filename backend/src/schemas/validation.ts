import { z } from "zod";

// NOTE — deliberate decisions on string fields not constrained to enums:
//
// - `status` on Issue/IssueAgent/IssuePR/Session: kept as z.string() intentionally.
//   The state machine lives in the orchestrator layer. Constraining it here would
//   require keeping two places in sync. Enum enforcement belongs at the route layer
//   once statuses are stable.
//
// - `created_by` / `author_type` / `actor_type`: these are accepted by the schema
//   but overwritten server-side in the route layer (e.g. created_by is forced to
//   "user" in the issues route). The fields remain in the schemas so internal
//   callers (orchestrator) can use them directly. This is safe because the server
//   only runs locally. If auth is added later, strip these from Create schemas
//   and populate them from the session.
//
// - `system_prompt` has no max length: no upper bound is enforced here. The LLM layer
//   should enforce context limits when the prompt is used. Add .max() here once the
//   target model's context window is decided.
//
// - `worktree_path` has no path-traversal validation: these paths
//   are not used in any fs/shell operation yet. Validate against an allowed base
//   directory when git/fs operations are introduced.

const githubUrl = z.string().url().refine(
  (url) => { try { return new URL(url).hostname === "github.com"; } catch { return false; } },
  { message: "Must be a GitHub URL" }
);

const CreateProjectBase = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  max_concurrency: z.number().int().positive().optional(),
  max_review_rounds: z.number().int().nonnegative().optional(),
  github_url: githubUrl.optional(),
  default_branch: z.string().optional(),
  github_account_id: z.string().nullable().optional(),
});

export const CreateProjectSchema = CreateProjectBase;

export const UpdateProjectSchema = CreateProjectBase.omit({
  github_url: true,
  default_branch: true,
}).partial().extend({
  orchestrator_session_id: z.string().nullable().optional(),
});

export const CreateRepoSchema = z.object({
  github_url: githubUrl,
  default_branch: z.string().optional(),
});

export const UpdateCrewSchema = z.object({
  name: z.string().min(1),
});

export const CreateAgentSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  system_prompt: z.string().min(1),
});

export const UpdateAgentSchema = CreateAgentSchema.partial();

export const GenerateAgentSchema = z.object({
  prompt: z.string().min(1),
});

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

export const InitDeviceFlowSchema = z.object({
  client_id: z.string().min(1).optional(),
});

export const PollDeviceFlowSchema = z.object({
  device_code: z.string().min(1),
  client_id: z.string().min(1).optional(),
});
