import type {
  Project,
  ProjectWithStats,
  Repo,
  Agent,
  Issue,
  IssueWithRunningAgent,
  IssueWithDetails,
  Comment,
  ActivityLog,
  VCSAccount,
  EnvironmentVariable,
  AgentRun,
  AgentRunWithEvents,
  ActiveRun,
  ProjectKnowledge,
  LibrarianStatus,
  ChatMessage,
  AgentConfig,
} from "./types.js";

export type {
  Project,
  ProjectWithStats,
  Repo,
  Agent,
  Issue,
  IssueWithRunningAgent,
  IssuePR,
  IssueWithDetails,
  Comment,
  ActivityLog,
  VCSAccount,
  EnvironmentVariable,
  AgentRun,
  AgentRunEvent,
  AgentRunWithEvents,
  ActiveRun,
  AgentRunStatus,
  AgentRunEventType,
  ProjectKnowledge,
  LibrarianStatus,
  ChatMessage,
  AgentConfig,
} from "./types.js";

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

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
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
    throw new ApiError(
      res.status,
      err.code ?? "UNKNOWN",
      err.message ?? res.statusText,
    );
  }
  return json as T;
}

const e = encodeURIComponent;

// Projects
export function listProjects() {
  return request<Project[]>("GET", "/projects");
}
export function getProject(id: string) {
  return request<Project>("GET", `/projects/${e(id)}`);
}
export function createProject(data: {
  repo_url: string;
  vcs_account_id?: string;
}) {
  return request<Project>("POST", "/projects", data);
}
export function updateProject(id: string, data: Partial<Project>) {
  return request<Project>("PATCH", `/projects/${e(id)}`, data);
}
export function deleteProject(id: string) {
  return request<void>("DELETE", `/projects/${e(id)}`);
}
export function listProjectsWithStats() {
  return request<ProjectWithStats[]>("GET", "/projects?stats");
}

// Repos
export function listRepos(projectId: string) {
  return request<Repo[]>("GET", `/projects/${e(projectId)}/repos`);
}
export function createRepo(
  projectId: string,
  data: { repo_url: string; default_branch?: string },
) {
  return request<Repo>("POST", `/projects/${e(projectId)}/repos`, data);
}
export function deleteRepo(projectId: string, repoId: string) {
  return request<void>(
    "DELETE",
    `/projects/${e(projectId)}/repos/${e(repoId)}`,
  );
}

// Agents (read-only — crew is fixed)
export function listAgents() {
  return request<Agent[]>("GET", "/crew");
}

export function listAllAgents() {
  return request<Agent[]>("GET", "/crew?all=true");
}

// Agent Config (per-project model overrides)
export function listAgentConfig(projectId: string) {
  return request<AgentConfig[]>(
    "GET",
    `/projects/${e(projectId)}/agent-config`,
  );
}
export function setAgentModel(
  projectId: string,
  agentId: string,
  model: string,
) {
  return request<AgentConfig>(
    "PUT",
    `/projects/${e(projectId)}/agent-config/${e(agentId)}`,
    { model },
  );
}
export function deleteAgentConfig(projectId: string, agentId: string) {
  return request<void>(
    "DELETE",
    `/projects/${e(projectId)}/agent-config/${e(agentId)}`,
  );
}

// Issues
export function listIssues(
  projectId: string,
  filters?: {
    status?: string;
    created_by?: string;
    sort?: string;
    order?: string;
  },
) {
  return request<IssueWithRunningAgent[]>(
    "GET",
    `/projects/${e(projectId)}/issues${qs(filters)}`,
  );
}
export function getIssue(projectId: string, issueId: string) {
  return request<IssueWithDetails>(
    "GET",
    `/projects/${e(projectId)}/issues/${e(issueId)}`,
  );
}
export function createIssue(
  projectId: string,
  data: { title: string; description: string },
) {
  return request<Issue>("POST", `/projects/${e(projectId)}/issues`, data);
}
export function updateIssue(
  projectId: string,
  issueId: string,
  data: Partial<Issue>,
) {
  return request<Issue>(
    "PATCH",
    `/projects/${e(projectId)}/issues/${e(issueId)}`,
    data,
  );
}
export function deleteIssue(projectId: string, issueId: string) {
  return request<void>(
    "DELETE",
    `/projects/${e(projectId)}/issues/${e(issueId)}`,
  );
}

// Comments
export function addComment(
  projectId: string,
  issueId: string,
  data: { content: string },
) {
  return request<Comment>(
    "POST",
    `/projects/${e(projectId)}/issues/${e(issueId)}/comments`,
    data,
  );
}
export function editComment(
  projectId: string,
  issueId: string,
  commentId: string,
  data: { content: string },
) {
  return request<Comment>(
    "PATCH",
    `/projects/${e(projectId)}/issues/${e(issueId)}/comments/${e(commentId)}`,
    data,
  );
}
export function deleteComment(
  projectId: string,
  issueId: string,
  commentId: string,
) {
  return request<void>(
    "DELETE",
    `/projects/${e(projectId)}/issues/${e(issueId)}/comments/${e(commentId)}`,
  );
}

// GitHub Accounts
export function listVCSAccounts() {
  return request<VCSAccount[]>("GET", "/vcs-accounts");
}
export function createVCSAccount(data: {
  account_name: string;
  username: string;
  token: string;
  ssh_private_key: string;
}) {
  return request<VCSAccount>("POST", "/vcs-accounts", data);
}
export function deleteVCSAccount(id: string) {
  return request<void>("DELETE", `/vcs-accounts/${e(id)}`);
}

// Activity
export function listActivity(
  projectId: string,
  filters?: {
    issue_id?: string;
    actor_type?: string;
    action?: string;
    since?: string;
    limit?: number;
    offset?: number;
  },
) {
  return request<ActivityLog[]>(
    "GET",
    `/projects/${e(projectId)}/activity${qs(filters)}`,
  );
}

// Environment Variables
export function listEnvironmentVariables(projectId: string) {
  return request<EnvironmentVariable[]>(
    "GET",
    `/projects/${e(projectId)}/environment`,
  );
}
export function createEnvironmentVariable(
  projectId: string,
  data: { key: string; value: string; is_secret?: boolean },
) {
  return request<EnvironmentVariable>(
    "POST",
    `/projects/${e(projectId)}/environment`,
    data,
  );
}
export function updateEnvironmentVariable(
  projectId: string,
  envVarId: string,
  data: { key?: string; value?: string; is_secret?: boolean },
) {
  return request<EnvironmentVariable>(
    "PATCH",
    `/projects/${e(projectId)}/environment/${e(envVarId)}`,
    data,
  );
}
export function deleteEnvironmentVariable(projectId: string, envVarId: string) {
  return request<void>(
    "DELETE",
    `/projects/${e(projectId)}/environment/${e(envVarId)}`,
  );
}

// Agent Runs
export function listIssueRuns(projectId: string, issueId: string) {
  return request<AgentRun[]>(
    "GET",
    `/projects/${e(projectId)}/issues/${e(issueId)}/runs`,
  );
}
export function getRun(projectId: string, runId: string) {
  return request<AgentRunWithEvents>(
    "GET",
    `/projects/${e(projectId)}/runs/${e(runId)}`,
  );
}
export function listProjectRuns(
  projectId: string,
  filters?: { limit?: number; offset?: number },
) {
  return request<AgentRun[]>(
    "GET",
    `/projects/${e(projectId)}/runs${qs(filters)}`,
  );
}

// Active Runs (for Terminals page)
export function listActiveRuns(projectId: string) {
  return request<ActiveRun[]>("GET", `/projects/${e(projectId)}/active-runs`);
}

// Knowledge
export function listKnowledge(projectId: string) {
  return request<ProjectKnowledge[]>(
    "GET",
    `/projects/${e(projectId)}/knowledge`,
  );
}
export function createKnowledge(
  projectId: string,
  data: { title: string; category: string; content: string },
) {
  return request<ProjectKnowledge>(
    "POST",
    `/projects/${e(projectId)}/knowledge`,
    data,
  );
}
export function updateKnowledge(
  projectId: string,
  knowledgeId: string,
  data: {
    title?: string;
    category?: string;
    content?: string;
  },
) {
  return request<ProjectKnowledge>(
    "PATCH",
    `/projects/${e(projectId)}/knowledge/${e(knowledgeId)}`,
    data,
  );
}
export function deleteKnowledge(projectId: string, knowledgeId: string) {
  return request<void>(
    "DELETE",
    `/projects/${e(projectId)}/knowledge/${e(knowledgeId)}`,
  );
}
export function triggerKnowledgeScan(projectId: string) {
  return request<{ agent_run_id: string }>(
    "POST",
    `/projects/${e(projectId)}/knowledge/scan`,
  );
}

export function getLibrarianStatus(projectId: string) {
  return request<LibrarianStatus>(
    "GET",
    `/projects/${e(projectId)}/librarian-status`,
  );
}

// Monitor history
export function getMonitorHistory(projectId: string, limit?: number) {
  const query = limit ? `?limit=${limit}` : "";
  return request<ChatMessage[]>(
    "GET",
    `/projects/${e(projectId)}/monitor/history${query}`,
  );
}

// Terminal sessions
export interface TerminalSession {
  projectId: string;
  tmuxSessionName: string;
  createdAt: string;
  lastAccessedAt?: string;
}

export interface TerminalSessionStatus {
  exists: boolean;
  projectId?: string;
  tmuxSessionName?: string;
  createdAt?: string;
  lastAccessedAt?: string;
}

export function createTerminalSession(projectId: string) {
  return request<TerminalSession>(
    "POST",
    `/projects/${e(projectId)}/terminal`,
  );
}

export function getTerminalSession(projectId: string) {
  return request<TerminalSessionStatus>(
    "GET",
    `/projects/${e(projectId)}/terminal`,
  );
}

export function destroyTerminalSession(projectId: string) {
  return request<{ destroyed: boolean }>(
    "DELETE",
    `/projects/${e(projectId)}/terminal`,
  );
}
