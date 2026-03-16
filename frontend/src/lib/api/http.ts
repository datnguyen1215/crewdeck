/**
 * HTTP API client — talks to the backend REST API at /api/v1/*.
 * Uses relative URLs so the Vite dev proxy and same-domain prod both work.
 */

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

/** Build a query string from an optional filter object. Returns "" or "?key=val&…". */
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

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function listProjects() {
  return request<Project[]>("GET", "/projects");
}

export function getProject(id: string) {
  return request<Project>("GET", `/projects/${encodeURIComponent(id)}`);
}

export function createProject(data: {
  github_url: string;
  github_account_id?: string;
}) {
  return request<Project>("POST", "/projects", data);
}

export function updateProject(id: string, data: Partial<Project>) {
  return request<Project>("PATCH", `/projects/${encodeURIComponent(id)}`, data);
}

export function deleteProject(id: string) {
  return request<void>("DELETE", `/projects/${encodeURIComponent(id)}`);
}

export function listProjectsWithStats() {
  return request<ProjectWithStats[]>("GET", "/projects?stats");
}

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

const e = encodeURIComponent;

export function listRepos(projectId: string) {
  return request<Repo[]>("GET", `/projects/${e(projectId)}/repos`);
}

export function createRepo(
  projectId: string,
  data: { github_url: string; default_branch?: string },
) {
  return request<Repo>("POST", `/projects/${e(projectId)}/repos`, data);
}

export function deleteRepo(projectId: string, repoId: string) {
  return request<void>(
    "DELETE",
    `/projects/${e(projectId)}/repos/${e(repoId)}`,
  );
}

// ---------------------------------------------------------------------------
// Crew & Agents
// ---------------------------------------------------------------------------

export function getCrew(projectId: string) {
  return request<CrewWithAgents>("GET", `/projects/${e(projectId)}/crew`);
}

export function updateCrew(projectId: string, data: { name: string }) {
  return request<Crew>("PATCH", `/projects/${e(projectId)}/crew`, data);
}

export function listAgents(projectId: string) {
  return request<Agent[]>("GET", `/projects/${e(projectId)}/crew/agents`);
}

export function createAgent(
  projectId: string,
  data: {
    name: string;
    title: string;
    description?: string;
    system_prompt: string;
    is_captain?: boolean;
  },
) {
  return request<Agent>("POST", `/projects/${e(projectId)}/crew/agents`, data);
}

export function generateAgent(
  projectId: string,
  data: { prompt: string },
) {
  return request<{ name: string; title: string; description: string; system_prompt: string }>(
    "POST",
    `/projects/${e(projectId)}/crew/agents/generate`,
    data,
  );
}

export function updateAgent(
  projectId: string,
  agentId: string,
  data: Partial<Agent>,
) {
  return request<Agent>(
    "PATCH",
    `/projects/${e(projectId)}/crew/agents/${e(agentId)}`,
    data,
  );
}

export function deleteAgent(projectId: string, agentId: string) {
  return request<void>(
    "DELETE",
    `/projects/${e(projectId)}/crew/agents/${e(agentId)}`,
  );
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export function listIssues(
  projectId: string,
  filters?: {
    status?: string;
    agent?: string;
    created_by?: string;
    sort?: string;
    order?: string;
  },
) {
  return request<Issue[]>(
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
  data: {
    title: string;
    description?: string;
    priority?: number;
    max_review_rounds?: number;
    created_by?: string;
  },
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

export function approveIssue(projectId: string, issueId: string) {
  return request<Issue>(
    "POST",
    `/projects/${e(projectId)}/issues/${e(issueId)}/approve`,
  );
}

export function discardIssue(projectId: string, issueId: string) {
  return request<void>(
    "POST",
    `/projects/${e(projectId)}/issues/${e(issueId)}/discard`,
  );
}

export function createPR(projectId: string, issueId: string) {
  return request<Issue>(
    "POST",
    `/projects/${e(projectId)}/issues/${e(issueId)}/create-pr`,
  );
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function listSessions(
  projectId: string,
  filters?: { status?: string; type?: string; issue_id?: string },
) {
  return request<Session[]>(
    "GET",
    `/projects/${e(projectId)}/sessions${qs(filters)}`,
  );
}

export function getSession(projectId: string, sessionId: string) {
  return request<Session>(
    "GET",
    `/projects/${e(projectId)}/sessions/${e(sessionId)}`,
  );
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function getOrchestratorStatus(projectId: string) {
  return request<OrchestratorStatus>(
    "GET",
    `/projects/${e(projectId)}/orchestrator/status`,
  );
}

export function startOrchestrator(
  projectId: string,
  context?: Record<string, unknown>,
) {
  return request<Session>(
    "POST",
    `/projects/${e(projectId)}/orchestrator/start`,
    context ? { context } : undefined,
  );
}

export function stopOrchestrator(projectId: string) {
  return request<{ status: string }>(
    "POST",
    `/projects/${e(projectId)}/orchestrator/stop`,
  );
}

// ---------------------------------------------------------------------------
// GitHub Accounts
// ---------------------------------------------------------------------------

export function listGitHubAccounts() {
  return request<GitHubAccount[]>("GET", "/github-accounts");
}

export function startDeviceFlow(clientId?: string) {
  return request<DeviceCodeResponse>("POST", "/github-accounts/device-code", clientId ? { client_id: clientId } : {});
}

export function pollDeviceFlow(deviceCode: string, clientId?: string) {
  return request<DeviceCodePollResponse>("POST", "/github-accounts/device-code/poll", {
    device_code: deviceCode,
    ...(clientId ? { client_id: clientId } : {}),
  });
}

export function deleteGitHubAccount(id: string) {
  return request<void>("DELETE", `/github-accounts/${e(id)}`);
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  description: string | null;
  max_concurrency: number;
  max_review_rounds: number;
  orchestrator_session_id: string | null;
  github_account_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithStats extends Project {
  repo_count: number;
  agent_count: number;
  issues: {
    open: number;
    in_progress: number;
    in_review: number;
    ready: number;
    done: number;
  };
  orchestrator_status: string;
}

export interface Repo {
  id: string;
  project_id: string;
  github_url: string;
  default_branch: string;
  created_at: string;
  updated_at: string;
}

export interface Crew {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  crew_id: string;
  name: string;
  title: string;
  description: string | null;
  system_prompt: string;
  is_captain: boolean;
  created_at: string;
  updated_at: string;
}

export interface CrewWithAgents extends Crew {
  agents: (Agent & {
    status?: "idle" | "working" | "reviewing";
    current_issue?: { id: string; title: string } | null;
  })[];
}

export interface Issue {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  assigned_agent_id: string | null;
  created_by: string;
  max_review_rounds: number | null;
  current_review_round: number;
  branch_name: string | null;
  worktree_path: string | null;
  base_branch: string;
  repo_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface IssueAgent {
  id: string;
  issue_id: string;
  agent_id: string;
  role: "worker" | "reviewer";
  status: string;
  review_order: number | null;
  agent: { id: string; name: string } | null;
}

export interface IssuePR {
  id: string;
  issue_id: string;
  pr_number: number;
  pr_url: string;
  status: string;
}

export interface IssueWithDetails extends Issue {
  assigned_agent: { id: string; name: string } | null;
  repo: { id: string; name: string } | null;
  comments: Comment[];
  activity_log: ActivityLog[];
  issue_agents: IssueAgent[];
  issue_prs: IssuePR[];
}

export interface Comment {
  id: string;
  issue_id: string;
  author_type: string;
  author_id: string | null;
  content: string;
  created_at: string;
}

export interface Session {
  id: string;
  project_id: string;
  session_type: string;
  agent_id: string | null;
  issue_id: string | null;
  tmux_session_name: string;
  tmux_pane_id: string | null;
  status: string;
  context: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityLog {
  id: string;
  project_id: string;
  issue_id: string | null;
  actor_type: string;
  actor_id: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface OrchestratorStatus {
  project_id: string;
  orchestrator_session_id: string | null;
  status: string;
  session: Session | null;
}

export interface GitHubAccount {
  id: string;
  account_name: string;
  github_username: string;
  scopes: string | null;
  created_at: string;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface DeviceCodePollResponse {
  id?: string;
  account_name?: string;
  github_username?: string;
  scopes?: string | null;
  created_at?: string;
  status?: string;
  error?: string;
  error_description?: string;
}
