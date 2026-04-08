import type {
  Project,
  ProjectWithStats,
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
  MonitorMessage,
  AgentConfig,
  MonitorEntry,
  CaptainStatus,
  GlobalConfig,
  GlobalEnvironmentVariable,
  ApiKey,
  ChatThread,
  ChatThreadListItem,
  ChatThreadDetail,
  ChatMessageEvent,
} from "./types.js";

export type {
  Project,
  ProjectWithStats,
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
  MonitorMessage,
  AgentConfig,
  MonitorEntry,
  CaptainStatus,
  GlobalConfig,
  GlobalEnvironmentVariable,
  ApiKey,
  ChatThread,
  ChatThreadListItem,
  ChatThreadDetail,
  ChatMessage,
  ChatMessageEventType,
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

// Auth (unauthenticated endpoints)
export function checkSetupStatus() {
  return request<{ needsSetup: boolean }>("GET", "/auth/setup-status");
}
export function setupAccount(username: string, password: string) {
  return request<{ id: string; username: string }>("POST", "/auth/setup", { username, password });
}
export function login(username: string, password: string) {
  return request<{ id: string; username: string }>("POST", "/auth/login", { username, password });
}
export function getAuthMe() {
  return request<{ setupCompleted: boolean }>("GET", "/auth/me");
}
export function logout() {
  return request<void>("POST", "/auth/logout");
}
export function completeSetup() {
  return request<{ ok: boolean }>("POST", "/auth/complete-setup");
}

// Preflight checks
export function getPreflightClaudeCli() {
  return request<{ installed: boolean; version?: string; path?: string }>(
    "GET",
    "/global-config/preflight/claude-cli",
  );
}
export function getPreflightClaudeAuth() {
  return request<{ authenticated: boolean; error?: string }>(
    "GET",
    "/global-config/preflight/claude-auth",
  );
}
export function getPreflightZai() {
  return request<{ configured: boolean; source?: string }>(
    "GET",
    "/global-config/preflight/zai",
  );
}

// Projects
export function getProject(id: string) {
  return request<Project>("GET", `/projects/${e(id)}`);
}
export function createProject(data: {
  repo_url: string;
  vcs_account_id?: string;
  default_base_branch?: string;
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

// Agents (read-only — crew is fixed)
export function listAgents() {
  return request<Agent[]>("GET", "/crew");
}

export function listAllAgents() {
  return request<Agent[]>("GET", "/crew?all=true");
}

// Agent Config (global model overrides)
export function listAgentConfig() {
  return request<AgentConfig[]>("GET", `/agent-config`);
}
export function setAgentModel(agentId: string, model: string) {
  return request<AgentConfig>("PUT", `/agent-config/${e(agentId)}`, { model });
}
export function deleteAgentConfig(agentId: string) {
  return request<void>("DELETE", `/agent-config/${e(agentId)}`);
}

// Issues
export interface ListIssuesResult {
  issues: IssueWithRunningAgent[];
  total: number;
  limit: number;
  offset: number;
}

export function listIssues(
  projectId: string,
  filters?: {
    status?: string;
    created_by?: string;
    sort?: string;
    order?: string;
    limit?: number;
    offset?: number;
  },
) {
  return request<ListIssuesResult>(
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
export function pauseIssue(projectId: string, issueId: string) {
  return request<void>(
    "POST",
    `/projects/${e(projectId)}/issues/${e(issueId)}/pause`,
  );
}
export function resumeIssue(projectId: string, issueId: string) {
  return request<void>(
    "POST",
    `/projects/${e(projectId)}/issues/${e(issueId)}/resume`,
  );
}
export function approveIssueStart(projectId: string, issueId: string) {
  return request<{
    success: boolean;
    issue_id: string;
    approved_to_start: boolean;
  }>("POST", `/projects/${e(projectId)}/issues/${e(issueId)}/approve-start`);
}
export function approveIssueMerge(projectId: string, issueId: string) {
  return request<{
    success: boolean;
    issue_id: string;
    approved_to_merge: boolean;
  }>("POST", `/projects/${e(projectId)}/issues/${e(issueId)}/approve-merge`);
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

export function listGlobalActivity(filters?: {
  limit?: number;
  since?: string;
}) {
  return request<ActivityLog[]>(
    "GET",
    `/activity${qs(filters)}`,
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
  // Frontend displays full run details, so use events_limit=0 for all events
  return request<AgentRunWithEvents>(
    "GET",
    `/projects/${e(projectId)}/runs/${e(runId)}?events_limit=0`,
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
  // Frontend UI displays events, so include them
  return request<ActiveRun[]>(
    "GET",
    `/projects/${e(projectId)}/active-runs?include_events=true`,
  );
}

export interface GlobalActiveRun extends ActiveRun {
  project_name: string | null;
}

export interface GlobalCaptainStatus extends CaptainStatus {
  project_id: string;
  project_name: string;
}

export function listActiveRunsGlobal(includeEvents = false) {
  return request<GlobalActiveRun[]>(
    "GET",
    `/global-config/active-runs${includeEvents ? "?include_events=true" : ""}`,
  );
}

export function listCaptainStatuses() {
  return request<GlobalCaptainStatus[]>("GET", "/global-config/captain-statuses");
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
export function getMonitorHistory(
  projectId: string,
  limit?: number,
): Promise<MonitorMessage[]> {
  const params = limit ? `?limit=${limit}` : "";
  return request("GET", `/projects/${e(projectId)}/monitor/history${params}`);
}

export interface GlobalMonitorMessage extends MonitorMessage {
  project_name: string | null;
}

export function getGlobalMonitorHistory(limit?: number): Promise<GlobalMonitorMessage[]> {
  const params = limit ? `?limit=${limit}` : "";
  return request("GET", `/global-config/captain-monitors${params}`);
}

// Captain status
export function getCaptainStatus(projectId: string): Promise<CaptainStatus> {
  return request("GET", `/projects/${e(projectId)}/captain/status`);
}

// Global Config
export function getGlobalConfig(): Promise<GlobalConfig> {
  return request("GET", "/global-config");
}
export function setDefaultModel(model: string): Promise<{ model: string }> {
  return request("PUT", "/global-config/default-model", { model });
}
export function getModelAvailability(): Promise<{
  claude: { available: boolean };
  glm: { available: boolean };
}> {
  return request("GET", "/global-config/model-availability");
}

// Orchestration settings
export function getActiveAgents(): Promise<{ activeAgents: number; maxConcurrency: number }> {
  return request("GET", "/global-config/active-agents");
}
export function setMaxConcurrency(maxConcurrency: number): Promise<{ maxConcurrency: number }> {
  return request("PUT", "/global-config/max-concurrency", { maxConcurrency });
}
export function setMaxChainDepth(maxChainDepth: number): Promise<{ maxChainDepth: number }> {
  return request("PUT", "/global-config/max-chain-depth", { maxChainDepth });
}
export function setAgentTimeoutMinutes(agentTimeoutMinutes: number): Promise<{ agentTimeoutMinutes: number }> {
  return request("PUT", "/global-config/agent-timeout-minutes", { agentTimeoutMinutes });
}

// Global Environment Variables
export function listGlobalEnvironmentVariables() {
  return request<GlobalEnvironmentVariable[]>(
    "GET",
    "/global-config/environment",
  );
}
export function createGlobalEnvironmentVariable(data: {
  key: string;
  value: string;
  is_secret?: boolean;
}) {
  return request<GlobalEnvironmentVariable>(
    "POST",
    "/global-config/environment",
    data,
  );
}
export function updateGlobalEnvironmentVariable(
  envVarId: string,
  data: { key?: string; value?: string; is_secret?: boolean },
) {
  return request<GlobalEnvironmentVariable>(
    "PATCH",
    `/global-config/environment/${e(envVarId)}`,
    data,
  );
}
export function deleteGlobalEnvironmentVariable(envVarId: string) {
  return request<void>("DELETE", `/global-config/environment/${e(envVarId)}`);
}

// API Keys
export function listApiKeys() {
  return request<ApiKey[]>("GET", "/api-keys");
}
export function createApiKey(name: string) {
  return request<ApiKey & { key: string }>("POST", "/api-keys", { name });
}
export function deleteApiKey(id: string) {
  return request<void>("DELETE", `/api-keys/${e(id)}`);
}

// Chat Threads
export function listChatThreads(projectId: string) {
  return request<ChatThreadListItem[]>("GET", `/projects/${e(projectId)}/chat/threads`);
}
export function createChatThread(projectId: string, data?: { title?: string }) {
  return request<ChatThread>("POST", `/projects/${e(projectId)}/chat/threads`, data);
}
export function getChatThread(threadId: string, projectId: string, limit?: number, offset?: number) {
  return request<ChatThreadDetail>("GET", `/projects/${e(projectId)}/chat/threads/${e(threadId)}${qs({ limit, offset })}`);
}
export function updateChatThread(threadId: string, projectId: string, data: { title?: string; session_id?: string | null }) {
  return request<ChatThread>("PATCH", `/projects/${e(projectId)}/chat/threads/${e(threadId)}`, data);
}
export function deleteChatThread(threadId: string, projectId: string) {
  return request<void>("DELETE", `/projects/${e(projectId)}/chat/threads/${e(threadId)}`);
}
export function sendChatMessage(threadId: string, projectId: string, content: string) {
  return request<{ message_id: string }>("POST", `/projects/${e(projectId)}/chat/threads/${e(threadId)}/messages`, { content });
}
export function getChatThreadStatus(threadId: string, projectId: string) {
  return request<{ active: boolean }>("GET", `/projects/${e(projectId)}/chat/threads/${e(threadId)}/status`);
}
export function getChatMessageEvents(threadId: string, messageId: string, projectId: string) {
  return request<{ events: ChatMessageEvent[] }>("GET", `/projects/${e(projectId)}/chat/threads/${e(threadId)}/messages/${e(messageId)}/events`);
}
