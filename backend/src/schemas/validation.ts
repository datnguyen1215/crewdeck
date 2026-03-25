import { z } from "zod";

const githubUrl = z
  .string()
  .url()
  .refine(
    (url) => {
      try {
        return new URL(url).hostname === "github.com";
      } catch {
        return false;
      }
    },
    { message: "Must be a GitHub URL" },
  );

const CreateProjectBase = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  max_concurrency: z.number().int().positive().optional(),
  github_url: githubUrl,
  default_branch: z.string().optional(),
  github_account_id: z.string().nullable().optional(),
});

export const CreateProjectSchema = CreateProjectBase;

export const UpdateProjectSchema = CreateProjectBase.omit({
  github_url: true,
  default_branch: true,
})
  .partial()
  .extend({
    admiral_enabled: z.boolean().optional(),
    auto_merge_enabled: z.boolean().optional(),
    max_chain_depth: z.number().int().positive().optional(),
    agent_timeout_minutes: z.number().int().min(1).max(60).optional(),
  });

export const CreateRepoSchema = z.object({
  github_url: githubUrl,
  default_branch: z.string().optional(),
});

export const CreateIssueSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  created_by: z.string().optional(),
});

export const UpdateIssueSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  status: z.string().optional(),
  chain_depth: z.number().int().nonnegative().optional(),
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

export const CreateActivitySchema = z.object({
  project_id: z.string(),
  issue_id: z.string().optional(),
  actor_type: z.string().min(1),
  actor_id: z.string().optional(),
  action: z.string().min(1),
  details: z.unknown().optional(),
});

export const CreateEnvironmentVariableSchema = z.object({
  key: z
    .string()
    .min(1)
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      "Must be a valid environment variable name",
    ),
  value: z.string(),
  is_secret: z.boolean().optional(),
});

export const UpdateEnvironmentVariableSchema = z.object({
  key: z
    .string()
    .min(1)
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      "Must be a valid environment variable name",
    )
    .optional(),
  value: z.string().optional(),
  is_secret: z.boolean().optional(),
});

// SSH key and PAT transmitted in plaintext — acceptable for local/self-hosted deployments behind TLS
export const CreateGitHubAccountSchema = z.object({
  account_name: z.string().min(1),
  github_username: z.string().min(1),
  gh_token: z.string().min(1),
  ssh_private_key: z.string().min(1),
});

export const UpdateGitHubAccountSchema = z.object({
  account_name: z.string().min(1).optional(),
  github_username: z.string().min(1).optional(),
  gh_token: z.string().min(1).optional(),
  ssh_private_key: z.string().min(1).optional(),
});

export const CreateKnowledgeSchema = z.object({
  title: z.string().min(1),
  category: z.string().min(1),
  content: z.string().min(1),
  source: z.string().optional(),
  agent_ids: z.array(z.string()).nullable().optional(),
});

export const UpdateKnowledgeSchema = z.object({
  title: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  source: z.string().nullable().optional(),
  agent_ids: z.array(z.string()).nullable().optional(),
});
