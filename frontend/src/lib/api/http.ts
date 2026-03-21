import type {
  Project,
  ProjectWithStats,
  Repo,
  Agent,
  Issue,
  IssueWithDetails,
  Comment,
  ActivityLog,
  GitHubAccount,
  DeviceCodeResponse,
  DeviceCodePollResponse,
  EnvironmentVariable,
  AgentRun,
  AgentRunWithEvents,
} from './types.js';

export type {
  Project,
  ProjectWithStats,
  Repo,
  Agent,
  Issue,
  IssuePR,
  IssueWithDetails,
  Comment,
  ActivityLog,
  GitHubAccount,
  DeviceCodeResponse,
  DeviceCodePollResponse,
  EnvironmentVariable,
  AgentRun,
  AgentRunEvent,
  AgentRunWithEvents,
  AgentRunStatus,
  AgentRunEventType,
} from './types.js';

const BASE = "/api/v1";

class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function qs(filters?: Record<string, unknown>): string {
  if (!filters) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  if (res.status === 204) return undefined as T;
  const json = await res.json();
  if (!res.ok) {
    const err = json.error ?? {};
    throw new ApiError(res.status, err.code ?? "UNKNOWN", err.message ?? res.statusText);
  }
  return json as T;
}

const e = encodeURIComponent;

// Projects
export function listProjects() { return request<Project[]>("GET", "/projects"); }
export function getProject(id: string) { return request<Project>("GET", `/projects/${e(id)}`); }
export function createProject(data: { github_url: string; github_account_id?: string }) {
  return request<Project>("POST", "/projects", data);
}
export function updateProject(id: string, data: Partial<Project>) {
  return request<Project>("PATCH", `/projects/${e(id)}`, data);
}
export function deleteProject(id: string) { return request<void>("DELETE", `/projects/${e(id)}`); }
export function listProjectsWithStats() { return request<ProjectWithStats[]>("GET", "/projects?stats"); }

// Repos
export function listRepos(projectId: string) { return request<Repo[]>("GET", `/projects/${e(projectId)}/repos`); }
export function createRepo(projectId: string, data: { github_url: string; default_branch?: string }) {
  return request<Repo>("POST", `/projects/${e(projectId)}/repos`, data);
}
export function deleteRepo(projectId: string, repoId: string) {
  return request<void>("DELETE", `/projects/${e(projectId)}/repos/${e(repoId)}`);
}

// Agents (read-only — crew is fixed)
export function listAgents() {
  return request<Agent[]>("GET", "/crew");
}

// Issues
export function listIssues(projectId: string, filters?: { status?: string; created_by?: string; sort?: string; order?: string }) {
  return request<Issue[]>("GET", `/projects/${e(projectId)}/issues${qs(filters)}`);
}
export function getIssue(projectId: string, issueId: string) {
  return request<IssueWithDetails>("GET", `/projects/${e(projectId)}/issues/${e(issueId)}`);
}
export function createIssue(projectId: string, data: { title: string; description: string; priority?: number }) {
  return request<Issue>("POST", `/projects/${e(projectId)}/issues`, data);
}
export function updateIssue(projectId: string, issueId: string, data: Partial<Issue>) {
  return request<Issue>("PATCH", `/projects/${e(projectId)}/issues/${e(issueId)}`, data);
}
export function deleteIssue(projectId: string, issueId: string) {
  return request<void>("DELETE", `/projects/${e(projectId)}/issues/${e(issueId)}`);
}

// Comments
export function addComment(projectId: string, issueId: string, data: { content: string }) {
  return request<Comment>("POST", `/projects/${e(projectId)}/issues/${e(issueId)}/comments`, data);
}
export function editComment(projectId: string, issueId: string, commentId: string, data: { content: string }) {
  return request<Comment>("PATCH", `/projects/${e(projectId)}/issues/${e(issueId)}/comments/${e(commentId)}`, data);
}
export function deleteComment(projectId: string, issueId: string, commentId: string) {
  return request<void>("DELETE", `/projects/${e(projectId)}/issues/${e(issueId)}/comments/${e(commentId)}`);
}

// GitHub Accounts
export function listGitHubAccounts() { return request<GitHubAccount[]>("GET", "/github-accounts"); }
export function startDeviceFlow(clientId?: string) {
  return request<DeviceCodeResponse>("POST", "/github-accounts/device-code", clientId ? { client_id: clientId } : {});
}
export function pollDeviceFlow(deviceCode: string, clientId?: string) {
  return request<DeviceCodePollResponse>("POST", "/github-accounts/device-code/poll", {
    device_code: deviceCode,
    ...(clientId ? { client_id: clientId } : {}),
  });
}
export function deleteGitHubAccount(id: string) { return request<void>("DELETE", `/github-accounts/${e(id)}`); }

// Activity
export function listActivity(projectId: string, filters?: { issue_id?: string; actor_type?: string; action?: string; since?: string; limit?: number; offset?: number }) {
  return request<ActivityLog[]>("GET", `/projects/${e(projectId)}/activity${qs(filters)}`);
}

// Environment Variables
export function listEnvironmentVariables(projectId: string) {
  return request<EnvironmentVariable[]>("GET", `/projects/${e(projectId)}/environment`);
}
export function createEnvironmentVariable(projectId: string, data: { key: string; value: string; is_secret?: boolean }) {
  return request<EnvironmentVariable>("POST", `/projects/${e(projectId)}/environment`, data);
}
export function updateEnvironmentVariable(projectId: string, envVarId: string, data: { key?: string; value?: string; is_secret?: boolean }) {
  return request<EnvironmentVariable>("PATCH", `/projects/${e(projectId)}/environment/${e(envVarId)}`, data);
}
export function deleteEnvironmentVariable(projectId: string, envVarId: string) {
  return request<void>("DELETE", `/projects/${e(projectId)}/environment/${e(envVarId)}`);
}

// Agent Runs
export function listIssueRuns(projectId: string, issueId: string) {
  return request<AgentRun[]>("GET", `/projects/${e(projectId)}/issues/${e(issueId)}/runs`);
}
export function getRun(projectId: string, runId: string) {
  return request<AgentRunWithEvents>("GET", `/projects/${e(projectId)}/runs/${e(runId)}`);
}
export function listProjectRuns(projectId: string, filters?: { limit?: number; offset?: number }) {
  return request<AgentRun[]>("GET", `/projects/${e(projectId)}/runs${qs(filters)}`);
}
