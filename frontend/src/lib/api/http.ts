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
  return request<Project>("GET", `/projects/${id}`);
}

export function createProject(data: {
  name: string;
  description?: string;
  max_concurrency?: number;
  max_review_rounds?: number;
  github_url?: string;
  default_branch?: string;
}) {
  return request<Project>("POST", "/projects", data);
}

export function updateProject(id: string, data: Partial<Project>) {
  return request<Project>("PATCH", `/projects/${id}`, data);
}

export function deleteProject(id: string) {
  return request<void>("DELETE", `/projects/${id}`);
}

/**
 * Fetches all projects with computed stats (repo count, agent count, issue
 * breakdown, orchestrator status). Composed from multiple endpoints since the
 * backend doesn't have a single stats endpoint.
 */
export async function listProjectsWithStats(): Promise<ProjectWithStats[]> {
  const projects = await listProjects();
  const results = await Promise.all(
    projects.map(async (project) => {
      const [repos, crew, issues, orchStatus] = await Promise.all([
        listRepos(project.id),
        getCrew(project.id).catch(() => null),
        listIssues(project.id),
        getOrchestratorStatus(project.id).catch(() => null),
      ]);

      const issueBreakdown = {
        open: 0,
        in_progress: 0,
        in_review: 0,
        ready: 0,
        done: 0,
      };
      for (const i of issues) {
        if (i.status in issueBreakdown) {
          issueBreakdown[i.status as keyof typeof issueBreakdown]++;
        }
      }

      let orchestrator_status = "none";
      if (orchStatus?.session) {
        orchestrator_status =
          orchStatus.session.status === "running"
            ? "active"
            : orchStatus.session.status === "error"
              ? "error"
              : "idle";
      }

      return {
        ...project,
        repo_count: repos.length,
        agent_count: crew?.agents?.length ?? 0,
        issues: issueBreakdown,
        orchestrator_status,
      };
    }),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

export function listRepos(projectId: string) {
  return request<Repo[]>("GET", `/projects/${projectId}/repos`);
}

export function createRepo(
  projectId: string,
  data: { github_url: string; default_branch?: string },
) {
  return request<Repo>("POST", `/projects/${projectId}/repos`, data);
}

export function deleteRepo(projectId: string, repoId: string) {
  return request<void>("DELETE", `/projects/${projectId}/repos/${repoId}`);
}

// ---------------------------------------------------------------------------
// Crew & Agents
// ---------------------------------------------------------------------------

export function getCrew(projectId: string) {
  return request<CrewWithAgents>("GET", `/projects/${projectId}/crew`);
}

export function updateCrew(projectId: string, data: { name: string }) {
  return request<Crew>("PATCH", `/projects/${projectId}/crew`, data);
}

export function listAgents(projectId: string) {
  return request<Agent[]>("GET", `/projects/${projectId}/crew/agents`);
}

export function createAgent(
  projectId: string,
  data: {
    name: string;
    role: string;
    expertise?: string[];
    system_prompt: string;
    can_review?: boolean;
  },
) {
  return request<Agent>("POST", `/projects/${projectId}/crew/agents`, data);
}

export function updateAgent(
  projectId: string,
  agentId: string,
  data: Partial<Agent>,
) {
  return request<Agent>(
    "PATCH",
    `/projects/${projectId}/crew/agents/${agentId}`,
    data,
  );
}

export function deleteAgent(projectId: string, agentId: string) {
  return request<void>(
    "DELETE",
    `/projects/${projectId}/crew/agents/${agentId}`,
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
  const params = new URLSearchParams();
  if (filters) {
    for (const [k, v] of Object.entries(filters)) {
      if (v) params.set(k, v);
    }
  }
  const qs = params.toString();
  return request<Issue[]>(
    "GET",
    `/projects/${projectId}/issues${qs ? `?${qs}` : ""}`,
  );
}

export function getIssue(projectId: string, issueId: string) {
  return request<IssueWithDetails>(
    "GET",
    `/projects/${projectId}/issues/${issueId}`,
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
  return request<Issue>("POST", `/projects/${projectId}/issues`, data);
}

export function updateIssue(
  projectId: string,
  issueId: string,
  data: Partial<Issue>,
) {
  return request<Issue>(
    "PATCH",
    `/projects/${projectId}/issues/${issueId}`,
    data,
  );
}

export function deleteIssue(projectId: string, issueId: string) {
  return request<void>("DELETE", `/projects/${projectId}/issues/${issueId}`);
}

export function approveIssue(projectId: string, issueId: string) {
  return request<Issue>(
    "POST",
    `/projects/${projectId}/issues/${issueId}/approve`,
  );
}

export function discardIssue(projectId: string, issueId: string) {
  return request<void>(
    "POST",
    `/projects/${projectId}/issues/${issueId}/discard`,
  );
}

export function createPR(projectId: string, issueId: string) {
  return request<Issue>(
    "POST",
    `/projects/${projectId}/issues/${issueId}/create-pr`,
  );
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export function listComments(projectId: string, issueId: string) {
  return request<Comment[]>(
    "GET",
    `/projects/${projectId}/issues/${issueId}/comments`,
  );
}

export function addComment(
  projectId: string,
  issueId: string,
  data: { content: string },
) {
  return request<Comment>(
    "POST",
    `/projects/${projectId}/issues/${issueId}/comments`,
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
  const params = new URLSearchParams();
  if (filters) {
    for (const [k, v] of Object.entries(filters)) {
      if (v) params.set(k, v);
    }
  }
  const qs = params.toString();
  return request<Session[]>(
    "GET",
    `/projects/${projectId}/sessions${qs ? `?${qs}` : ""}`,
  );
}

export function getSession(projectId: string, sessionId: string) {
  return request<Session>(
    "GET",
    `/projects/${projectId}/sessions/${sessionId}`,
  );
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function getOrchestratorStatus(projectId: string) {
  return request<OrchestratorStatus>(
    "GET",
    `/projects/${projectId}/orchestrator/status`,
  );
}

export function startOrchestrator(
  projectId: string,
  context?: Record<string, unknown>,
) {
  return request<Session>(
    "POST",
    `/projects/${projectId}/orchestrator/start`,
    context ? { context } : undefined,
  );
}

export function stopOrchestrator(projectId: string) {
  return request<{ status: string }>(
    "POST",
    `/projects/${projectId}/orchestrator/stop`,
  );
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
  const params = new URLSearchParams();
  if (filters) {
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
  }
  const qs = params.toString();
  return request<ActivityLog[]>(
    "GET",
    `/projects/${projectId}/activity${qs ? `?${qs}` : ""}`,
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
  role: string;
  expertise: string[];
  system_prompt: string;
  can_review: boolean;
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
