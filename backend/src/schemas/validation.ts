import { z } from "zod";
import { ISSUE_STATUSES, PR_STATUSES } from "../constants/statuses.js";
import { logger } from "../logger.js";

const githubUrl = z
  .string()
  .url()
  .refine(
    (url) => {
      try {
        return new URL(url).hostname === "github.com";
      } catch {
        logger.debug({ url }, "Failed to parse URL in GitHub URL validation");
        return false;
      }
    },
    { message: "Must be a GitHub URL" },
  );

const CreateProjectBase = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  repo_url: githubUrl,
  default_branch: z.string().optional(),
  default_base_branch: z.string().min(1).optional(),
  vcs_account_id: z.string().nullable().optional(),
});

export const CreateProjectSchema = CreateProjectBase;

export const UpdateProjectSchema = CreateProjectBase.omit({
  repo_url: true,
  default_branch: true,
})
  .partial()
  .extend({
    auto_start: z.boolean().optional(),
    auto_merge: z.boolean().optional(),
    default_base_branch: z.string().min(1).optional(),
  });

export const CreateRepoSchema = z.object({
  repo_url: githubUrl,
  default_branch: z.string().optional(),
});

export const CreateIssueSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  created_by: z.string().optional(),
  base_branch: z.string().min(1).optional(),
});

export const SetDependenciesSchema = z.object({
  depends_on: z.array(z.string().min(1)),
});

export const UpdateIssueSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  summary: z.string().optional(),
  status: z.enum(ISSUE_STATUSES as [string, ...string[]]).optional(),
  chain_depth: z.number().int().nonnegative().optional(),
  branch_name: z.string().nullable().optional(),
  worktree_path: z.string().nullable().optional(),
  base_branch: z.string().nullable().optional(),
  repo_id: z.string().nullable().optional(),
});

export const CreateCommentSchema = z.object({
  content: z.string().min(1),
  author_type: z.string().optional(),
});

export const CreateIssuePRSchema = z.object({
  issue_id: z.string(),
  repo_id: z.string(),
  pr_number: z.number().int().positive(),
  pr_url: z.string().url(),
  status: z.enum(PR_STATUSES as [string, ...string[]]).optional(),
});

export const UpdateIssuePRSchema = z.object({
  status: z.enum(PR_STATUSES as [string, ...string[]]).optional(),
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
export const CreateVCSAccountSchema = z.object({
  provider: z.string().min(1).optional(),
  account_name: z.string().min(1),
  username: z.string().min(1),
  token: z.string().min(1),
  ssh_private_key: z.string().min(1),
});

export const UpdateVCSAccountSchema = z.object({
  account_name: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  token: z.string().min(1).optional(),
  ssh_private_key: z.string().min(1).optional(),
});

export const CreateKnowledgeSchema = z.object({
  title: z.string().min(1),
  category: z.string().min(1),
  content: z.string().min(1),
  source: z.string().optional(),
});

export const UpdateKnowledgeSchema = z.object({
  title: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  source: z.string().nullable().optional(),
});

export const CreateGlobalEnvironmentVariableSchema = z.object({
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

export const UpdateGlobalEnvironmentVariableSchema = z.object({
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
