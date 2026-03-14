/**
 * API client — thin wrapper around fetch for the backend REST API.
 * All functions return Promises. Errors throw with a .status property.
 */

const BASE = "/api/v1";

/** @param {string} path @param {RequestInit} [options] */
async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = /** @type {Error & { status: number }} */ (
      new Error(body.message || body.error || `Request failed: ${res.status}`)
    );
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined;
  return res.json();
}

function qs(params) {
  const entries = Object.entries(params).filter(
    ([, v]) => v != null && v !== "",
  );
  if (entries.length === 0) return "";
  return (
    "?" +
    new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()
  );
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function listProjects() {
  return request("/projects");
}

export async function listProjectsWithStats() {
  const [projects, allRepos, allSessions] = await Promise.all([
    request("/projects"),
    // Fetch repos/agents/issues per project below
    Promise.resolve(null),
    Promise.resolve(null),
  ]);

  // For each project, fetch stats in parallel
  const enriched = await Promise.all(
    projects.map(async (project) => {
      const [repos, crew, issues, sessions] = await Promise.all([
        request(`/projects/${project.id}/repos`),
        request(`/projects/${project.id}/crew`).catch(() => null),
        request(`/projects/${project.id}/issues`),
        request(`/projects/${project.id}/sessions`),
      ]);

      const issueBreakdown = {
        open: 0,
        in_progress: 0,
        in_review: 0,
        ready: 0,
        done: 0,
      };
      for (const i of issues) {
        if (i.status in issueBreakdown) issueBreakdown[i.status]++;
      }

      const orchSession = project.orchestrator_session_id
        ? sessions.find((s) => s.id === project.orchestrator_session_id)
        : null;
      const orchestratorStatus = !orchSession
        ? "none"
        : orchSession.status === "running"
          ? "active"
          : orchSession.status === "error"
            ? "error"
            : "idle";

      return {
        ...project,
        repo_count: repos.length,
        agent_count: crew?.agents?.length ?? 0,
        issues: issueBreakdown,
        orchestrator_status: orchestratorStatus,
      };
    }),
  );

  return enriched;
}

export async function getProject(id) {
  return request(`/projects/${id}`);
}

export async function createProject(data) {
  return request("/projects", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateProject(id, data) {
  return request(`/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteProject(id) {
  return request(`/projects/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

export async function listRepos(projectId) {
  return request(`/projects/${projectId}/repos`);
}

export async function addRepo(projectId, data) {
  return request(`/projects/${projectId}/repos`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function removeRepo(projectId, repoId) {
  return request(`/projects/${projectId}/repos/${repoId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Crew
// ---------------------------------------------------------------------------

export async function getCrew(projectId) {
  const crew = await request(`/projects/${projectId}/crew`);
  // Compute agent status/current_issue from active issues
  const issues = await request(`/projects/${projectId}/issues`);
  crew.agents = crew.agents.map((agent) => {
    const activeIssue = issues.find(
      (i) =>
        i.assigned_agent_id === agent.id &&
        ["in_progress", "in_review", "feedback"].includes(i.status),
    );
    const status = !activeIssue
      ? "idle"
      : activeIssue.status === "in_progress"
        ? "working"
        : "reviewing";
    return { ...agent, status, current_issue: activeIssue ?? null };
  });
  return crew;
}

export async function updateCrew(projectId, data) {
  return request(`/projects/${projectId}/crew`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export async function listAgents(projectId) {
  return request(`/projects/${projectId}/crew/agents`);
}

export async function getAgent(projectId, agentId) {
  // No dedicated endpoint; filter from list
  const agents = await listAgents(projectId);
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) {
    const err = /** @type {Error & { status: number }} */ (
      new Error("Agent not found")
    );
    err.status = 404;
    throw err;
  }
  return agent;
}

export async function createAgent(projectId, data) {
  return request(`/projects/${projectId}/crew/agents`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateAgent(projectId, agentId, data) {
  return request(`/projects/${projectId}/crew/agents/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteAgent(projectId, agentId) {
  return request(`/projects/${projectId}/crew/agents/${agentId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

/** @param {string} projectId @param {Record<string, any>} [filters] */
export async function listIssues(projectId, filters = {}) {
  /** @type {Record<string, string>} */ const params = {};
  if (filters.status) params.status = filters.status;
  if (filters.assigned_agent_id) params.agent = filters.assigned_agent_id;
  if (filters.created_by) params.created_by = filters.created_by;
  if (filters.sort) params.sort = filters.sort;
  if (filters.order) params.order = filters.order;
  return request(`/projects/${projectId}/issues${qs(params)}`);
}

export async function getIssue(projectId, issueId) {
  const data = await request(`/projects/${projectId}/issues/${issueId}`);
  // Remap backend shape to match what frontend pages expect
  // Backend: { comments, agents, prs, activity }
  // Frontend expects: { comments, issue_agents (with .agent resolved), issue_prs, activity_log, assigned_agent, repo }
  const allAgents = await listAgents(projectId).catch(() => []);
  const repos = await listRepos(projectId).catch(() => []);

  return {
    ...data,
    assigned_agent: data.assigned_agent_id
      ? (allAgents.find((a) => a.id === data.assigned_agent_id) ?? null)
      : null,
    repo: data.repo_id
      ? (repos.find((r) => r.id === data.repo_id) ?? null)
      : null,
    comments: data.comments ?? [],
    activity_log: data.activity ?? [],
    issue_agents: (data.agents ?? []).map((ia) => ({
      ...ia,
      agent: allAgents.find((a) => a.id === ia.agent_id) ?? null,
    })),
    issue_prs: data.prs ?? [],
  };
}

export async function createIssue(projectId, data) {
  return request(`/projects/${projectId}/issues`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateIssue(projectId, issueId, data) {
  return request(`/projects/${projectId}/issues/${issueId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function approveIssue(projectId, issueId) {
  return request(`/projects/${projectId}/issues/${issueId}/approve`, {
    method: "POST",
  });
}

export async function discardIssue(projectId, issueId) {
  return request(`/projects/${projectId}/issues/${issueId}/discard`, {
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function listComments(projectId, issueId) {
  return request(`/projects/${projectId}/issues/${issueId}/comments`);
}

export async function addComment(projectId, issueId, data) {
  return request(`/projects/${projectId}/issues/${issueId}/comments`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** @param {string} projectId @param {Record<string, any>} [filters] */
export async function listSessions(projectId, filters = {}) {
  /** @type {Record<string, string>} */ const params = {};
  if (filters.status) params.status = filters.status;
  if (filters.session_type) params.type = filters.session_type;
  if (filters.issue_id) params.issue_id = filters.issue_id;
  return request(`/projects/${projectId}/sessions${qs(params)}`);
}

export async function getSession(projectId, sessionId) {
  return request(`/projects/${projectId}/sessions/${sessionId}`);
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

/** @param {string} projectId @param {Record<string, any>} [filters] */
export async function listActivity(projectId, filters = {}) {
  /** @type {Record<string, string>} */ const params = {};
  if (filters.issue_id) params.issue_id = filters.issue_id;
  // Backend accepts single actor_type; frontend may send actor_types array
  if (filters.actor_types?.length === 1)
    params.actor_type = filters.actor_types[0];
  else if (filters.actor_type) params.actor_type = filters.actor_type;
  if (filters.action) params.action = filters.action;
  if (filters.since) params.since = filters.since;
  if (filters.limit) params.limit = filters.limit;
  if (filters.offset) params.offset = filters.offset;
  return request(`/projects/${projectId}/activity${qs(params)}`);
}
