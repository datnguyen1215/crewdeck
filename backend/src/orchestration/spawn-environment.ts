/**
 * Environment and context preparation for agent spawning.
 */
import fs from "node:fs";
import * as agentPrompt from "./prompt.js";
import * as issueRepo from "../db/repositories/issues.js";
import * as commentRepo from "../db/repositories/comments.js";
import * as knowledgeRepo from "../db/repositories/knowledge.js";
import * as envVarRepo from "../db/repositories/environment-variables.js";
import * as globalEnvVarRepo from "../db/repositories/global-environment-variables.js";
import * as repoRepo from "../db/repositories/repos.js";
import * as agentWorktree from "./worktree.js";
import * as log from "../logger.js";
import { createGitSshEnv, getProjectCredentials } from "../utils/git-auth.js";

/**
 * Assemble environment dict with CREWDECK_* vars, SSH credentials, and GH_TOKEN.
 * Returns env record, optional SSH key path for cleanup, and the resolved creds.
 * Pass creds explicitly to avoid a redundant getProjectCredentials() call.
 */
export function buildAgentEnvironment(
  projectId: string,
  agentId: string,
  issueId: string,
  creds?: ReturnType<typeof getProjectCredentials>,
): {
  env: Record<string, string>;
  sshKeyPath?: string;
  creds: ReturnType<typeof getProjectCredentials>;
} {
  // Merge env vars: process.env < global env vars < project env vars
  const globalEnvVars = globalEnvVarRepo.getMap();
  const projectEnvVars = envVarRepo.getEnvironmentVariablesMap(projectId);
  const env: Record<string, string> = {
    ...globalEnvVars,
    ...projectEnvVars,
    CREWDECK_API_URL: `http://localhost:${process.env.PORT || "9381"}`,
    CREWDECK_PROJECT_ID: projectId,
    CREWDECK_AGENT_ID: agentId,
    CREWDECK_ISSUE_ID: issueId,
  };

  let sshKeyPath: string | undefined;
  const resolvedCreds = creds ?? getProjectCredentials(projectId);
  if (resolvedCreds) {
    const ssh = createGitSshEnv(resolvedCreds.sshPrivateKey);
    sshKeyPath = ssh.keyPath;
    Object.assign(env, ssh.env);
    env.GH_TOKEN = resolvedCreds.ghToken;
  }

  return { env, sshKeyPath, creds: resolvedCreds };
}

/**
 * Check if worktree exists on disk; if not, re-fetch repo and recreate.
 * Returns the resolved worktree path (or null if no repo).
 * Accepts optional creds to avoid a redundant getProjectCredentials() call.
 */
export async function validateOrRecreateWorktree(
  issueId: string,
  projectId: string,
  currentWorktreePath: string | null,
  creds?: ReturnType<typeof getProjectCredentials>,
): Promise<string | null> {
  const repo = repoRepo.listRepos(projectId)[0] ?? null;
  const resolvedCreds = creds ?? getProjectCredentials(projectId);
  let worktreePath = currentWorktreePath;

  if (worktreePath && !fs.existsSync(worktreePath)) {
    log.logger.info(
      { worktreePath, issueId },
      "Worktree path missing, will re-create",
    );
    worktreePath = null;
  }

  if (!worktreePath && repo) {
    const freshIssue = issueRepo.getIssue(issueId)!;
    const result = await agentWorktree.createWorktree(
      repo as any,
      freshIssue,
      freshIssue.base_branch || "main",
      resolvedCreds?.sshPrivateKey,
    );
    worktreePath = result.path;
  }

  return worktreePath;
}

/**
 * Fetch comments + knowledge and build agent prompt.
 */
export function buildAgentPrompt(
  issueId: string,
  projectId: string,
  worktreePath: string | null,
  agentId: string,
): string {
  const repo = repoRepo.listRepos(projectId)[0] ?? null;
  const comments = commentRepo.listComments(issueId);
  const projectKnowledge = knowledgeRepo.listByProject(projectId);

  return agentPrompt.buildPrompt({
    issue: issueRepo.getIssue(issueId)!,
    comments,
    repo,
    worktreePath: worktreePath ?? ".",
    agentId,
    projectKnowledge,
  });
}
