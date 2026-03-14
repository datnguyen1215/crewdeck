/**
 * Mock API — mirrors REST endpoints from the API spec.
 * All functions return Promises with artificial delay.
 * CRUD operations mutate the in-memory data arrays.
 */

import { delay } from './delay.js';
import * as db from './data.js';

// Decision: Math.random() is fine for mock IDs. Real backend should use crypto.randomUUID().
const uid = () => Math.random().toString(36).slice(2, 9);
const now = () => new Date().toISOString();

function notFound(resource) {
	throw Object.assign(new Error(`${resource} not found`), { status: 404 });
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function listProjects() {
	await delay();
	return [...db.projects];
}

export async function listProjectsWithStats() {
	await delay();
	return db.projects.map((project) => {
		const repos = db.repos.filter((r) => r.project_id === project.id);
		const crew = db.crews.find((c) => c.project_id === project.id);
		const agents = crew ? db.agents.filter((a) => a.crew_id === crew.id) : [];
		const projectIssues = db.issues.filter((i) => i.project_id === project.id);

		const issueBreakdown = { open: 0, in_progress: 0, in_review: 0, ready: 0, done: 0 };
		for (const i of projectIssues) {
			if (i.status in issueBreakdown) issueBreakdown[i.status]++;
		}

		const orchSession = project.orchestrator_session_id
			? db.sessions.find((s) => s.id === project.orchestrator_session_id)
			: null;

		const orchestratorStatus = !orchSession
			? 'none'
			: orchSession.status === 'running'
				? 'active'
				: orchSession.status === 'error'
					? 'error'
					: 'idle';

		return {
			...project,
			repo_count: repos.length,
			agent_count: agents.length,
			issues: issueBreakdown,
			orchestrator_status: orchestratorStatus
		};
	});
}

export async function getProject(id) {
	await delay();
	const project = db.projects.find((p) => p.id === id);
	if (!project) notFound('Project');
	return { ...project };
}

export async function createProject(data) {
	await delay();
	const project = {
		id: `proj-${uid()}`,
		name: data.name,
		description: data.description ?? null,
		max_concurrency: data.max_concurrency ?? 1,
		max_review_rounds: data.max_review_rounds ?? 3,
		orchestrator_session_id: null,
		created_at: now(),
		updated_at: now()
	};
	db.projects.push(project);

	if (data.github_url && data.local_path) {
		const url = data.github_url;
		const [, owner, name] = new URL(url).pathname.split('/');
		const repo = {
			id: `repo-${uid()}`,
			project_id: project.id,
			github_url: url,
			name,
			owner,
			local_path: data.local_path,
			default_branch: data.default_branch ?? 'main',
			created_at: now()
		};
		db.repos.push(repo);
	}

	return { ...project };
}

export async function updateProject(id, data) {
	await delay();
	const project = db.projects.find((p) => p.id === id);
	if (!project) notFound('Project');
	// Decision: Object.assign with no field whitelist is intentional for the mock layer.
	// Real backend must only accept permitted fields to prevent mass assignment.
	Object.assign(project, data, { updated_at: now() });
	return { ...project };
}

export async function deleteProject(id) {
	await delay();
	const idx = db.projects.findIndex((p) => p.id === id);
	if (idx === -1) notFound('Project');
	db.projects.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

export async function listRepos(projectId) {
	await delay();
	return db.repos.filter((r) => r.project_id === projectId);
}

export async function addRepo(projectId, data) {
	await delay();
	const url = data.github_url;
	// Decision: no URL validation here — mock only. Real backend must validate the URL format.
	const [, owner, name] = new URL(url).pathname.split('/');
	const repo = {
		id: `repo-${uid()}`,
		project_id: projectId,
		github_url: url,
		name,
		owner,
		local_path: data.local_path,
		default_branch: 'main',
		created_at: now()
	};
	db.repos.push(repo);
	return { ...repo };
}

export async function removeRepo(projectId, repoId) {
	await delay();
	const idx = db.repos.findIndex((r) => r.id === repoId && r.project_id === projectId);
	if (idx === -1) notFound('Repo');
	db.repos.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// Crew
// ---------------------------------------------------------------------------

export async function getCrew(projectId) {
	await delay();
	const crew = db.crews.find((c) => c.project_id === projectId);
	if (!crew) notFound('Crew');
	const crewAgents = db.agents.filter((a) => a.crew_id === crew.id);
	const agents = crewAgents.map((agent) => {
		const activeIssue = db.issues.find(
			(i) =>
				i.project_id === projectId &&
				i.assigned_agent_id === agent.id &&
				['in_progress', 'in_review', 'feedback'].includes(i.status)
		);
		const status = !activeIssue
			? 'idle'
			: activeIssue.status === 'in_progress'
				? 'working'
				: 'reviewing';
		return { ...agent, status, current_issue: activeIssue ?? null };
	});
	return { ...crew, agents };
}

export async function updateCrew(projectId, data) {
	await delay();
	const crew = db.crews.find((c) => c.project_id === projectId);
	if (!crew) notFound('Crew');
	// Decision: same intentional mass assignment as updateProject — mock only.
	Object.assign(crew, data, { updated_at: now() });
	return { ...crew };
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export async function listAgents(projectId) {
	await delay();
	const crew = db.crews.find((c) => c.project_id === projectId);
	if (!crew) return [];
	return db.agents.filter((a) => a.crew_id === crew.id);
}

export async function getAgent(projectId, agentId) {
	await delay();
	const crew = db.crews.find((c) => c.project_id === projectId);
	const agent = db.agents.find((a) => a.id === agentId && a.crew_id === crew?.id);
	if (!agent) notFound('Agent');
	return { ...agent };
}

export async function createAgent(projectId, data) {
	await delay();
	const crew = db.crews.find((c) => c.project_id === projectId);
	if (!crew) notFound('Crew');
	const agent = {
		id: `agent-${uid()}`,
		crew_id: crew.id,
		name: data.name,
		role: data.role,
		expertise: data.expertise ?? [],
		system_prompt: data.system_prompt,
		can_review: data.can_review ?? true,
		created_at: now(),
		updated_at: now()
	};
	db.agents.push(agent);
	return { ...agent };
}

export async function updateAgent(projectId, agentId, data) {
	await delay();
	const crew = db.crews.find((c) => c.project_id === projectId);
	const agent = db.agents.find((a) => a.id === agentId && a.crew_id === crew?.id);
	if (!agent) notFound('Agent');
	// Decision: same intentional mass assignment as updateProject — mock only.
	Object.assign(agent, data, { updated_at: now() });
	return { ...agent };
}

export async function deleteAgent(projectId, agentId) {
	await delay();
	const crew = db.crews.find((c) => c.project_id === projectId);
	const idx = db.agents.findIndex((a) => a.id === agentId && a.crew_id === crew?.id);
	if (idx === -1) notFound('Agent');
	db.agents.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export async function listIssues(projectId, filters = {}) {
	await delay();
	let result = db.issues.filter((i) => i.project_id === projectId);
	if (filters.status) {
		const statuses = filters.status.split(',');
		result = result.filter((i) => statuses.includes(i.status));
	}
	if (filters.assigned_agent_id) {
		result = result.filter((i) => i.assigned_agent_id === filters.assigned_agent_id);
	}
	if (filters.created_by) {
		result = result.filter((i) => i.created_by === filters.created_by);
	}
	const sort = filters.sort ?? 'priority';
	const order = filters.order ?? 'desc';
	// Decision: sort key is not validated against an allowlist — mock only.
	// Real backend must validate sort against permitted fields (e.g. priority, created_at).
	result.sort((a, b) => {
		const av = a[sort] ?? 0;
		const bv = b[sort] ?? 0;
		return order === 'desc' ? (bv > av ? 1 : bv < av ? -1 : 0) : (av > bv ? 1 : av < bv ? -1 : 0);
	});
	return result;
}

export async function getIssue(projectId, issueId) {
	await delay();
	const issue = db.issues.find((i) => i.id === issueId && i.project_id === projectId);
	if (!issue) notFound('Issue');
	const issueComments = db.comments.filter((c) => c.issue_id === issueId);
	const issueActivity = db.activity.filter((a) => a.issue_id === issueId);
	const assignedAgent = issue.assigned_agent_id
		? db.agents.find((a) => a.id === issue.assigned_agent_id)
		: null;
	const repo = issue.repo_id ? db.repos.find((r) => r.id === issue.repo_id) : null;
	const issueAgents = (db.issue_agents ?? [])
		.filter((ia) => ia.issue_id === issueId)
		.map((ia) => ({ ...ia, agent: db.agents.find((a) => a.id === ia.agent_id) ?? null }));
	const issuePRs = (db.issue_prs ?? []).filter((p) => p.issue_id === issueId);
	return {
		...issue,
		assigned_agent: assignedAgent ?? null,
		repo: repo ?? null,
		comments: issueComments,
		activity_log: issueActivity,
		issue_agents: issueAgents,
		issue_prs: issuePRs
	};
}

export async function createIssue(projectId, data) {
	await delay();
	const issue = {
		id: `issue-${uid()}`,
		project_id: projectId,
		title: data.title,
		description: data.description,
		status: 'open',
		priority: 0,
		assigned_agent_id: null,
		created_by: 'user',
		max_review_rounds: data.max_review_rounds ?? null,
		current_review_round: 0,
		branch_name: null,
		worktree_path: null,
		base_branch: 'main',
		repo_id: null,
		created_at: now(),
		updated_at: now()
	};
	db.issues.push(issue);
	return { ...issue };
}

export async function updateIssue(projectId, issueId, data) {
	await delay();
	const issue = db.issues.find((i) => i.id === issueId && i.project_id === projectId);
	if (!issue) notFound('Issue');
	// Decision: same intentional mass assignment as updateProject — mock only.
	Object.assign(issue, data, { updated_at: now() });
	return { ...issue };
}

export async function approveIssue(projectId, issueId) {
	await delay();
	const issue = db.issues.find((i) => i.id === issueId && i.project_id === projectId);
	if (!issue) notFound('Issue');
	// Decision: throws plain Error (no .status) unlike notFound — inconsistency is minor for mock.
	if (issue.status !== 'draft') throw new Error('Issue must be in draft status');
	issue.status = 'open';
	issue.updated_at = now();
	return { ...issue };
}

export async function discardIssue(projectId, issueId) {
	await delay();
	const issue = db.issues.find((i) => i.id === issueId && i.project_id === projectId);
	if (!issue) notFound('Issue');
	// Decision: same plain Error as approveIssue — minor inconsistency, acceptable for mock.
	if (issue.status !== 'draft') throw new Error('Issue must be in draft status');
	const idx = db.issues.indexOf(issue);
	db.issues.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

// Decision: projectId is intentionally unused — mock doesn't enforce cross-project scoping here.
// Real backend enforces this via the /projects/{projectId}/issues/{issueId}/comments route.
export async function listComments(projectId, issueId) {
	await delay();
	return db.comments.filter((c) => c.issue_id === issueId);
}

export async function addComment(projectId, issueId, data) {
	await delay();
	const comment = {
		id: `comment-${uid()}`,
		issue_id: issueId,
		author_type: 'user',
		author_id: null,
		content: data.content,
		created_at: now()
	};
	db.comments.push(comment);
	return { ...comment };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function listSessions(projectId, filters = {}) {
	await delay();
	let result = db.sessions.filter((s) => s.project_id === projectId);
	if (filters.status) result = result.filter((s) => s.status === filters.status);
	if (filters.session_type) result = result.filter((s) => s.session_type === filters.session_type);
	return result;
}

export async function getSession(projectId, sessionId) {
	await delay();
	const session = db.sessions.find((s) => s.id === sessionId && s.project_id === projectId);
	if (!session) notFound('Session');
	return { ...session };
}

export async function getSessionOutput(projectId, sessionId) {
	await delay();
	const session = db.sessions.find((s) => s.id === sessionId && s.project_id === projectId);
	if (!session) notFound('Session');
	return {
		output: '$ claude --resume\n> Analyzing issue backlog...\n> Priority queue updated.',
		is_active: session.status === 'running'
	};
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export async function listActivity(projectId, filters = {}) {
	await delay();
	let result = db.activity.filter((a) => a.project_id === projectId);
	if (filters.issue_id) result = result.filter((a) => a.issue_id === filters.issue_id);
	if (filters.actor_types?.length) result = result.filter((a) => filters.actor_types.includes(a.actor_type));
	else if (filters.actor_type) result = result.filter((a) => a.actor_type === filters.actor_type);
	if (filters.action) result = result.filter((a) => a.action === filters.action);
	if (filters.since) result = result.filter((a) => a.created_at >= filters.since);
	result.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
	const limit = filters.limit ?? 50;
	const offset = filters.offset ?? 0;
	return result.slice(offset, offset + limit);
}
