/**
 * Mock API — mirrors REST endpoints from the API spec.
 * All functions return Promises with artificial delay.
 * CRUD operations mutate the in-memory data arrays.
 */

import { delay } from './delay.js';
import * as db from './data.js';

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
	return { ...project };
}

export async function updateProject(id, data) {
	await delay();
	const project = db.projects.find((p) => p.id === id);
	if (!project) notFound('Project');
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
	const [owner, name] = url.replace('https://github.com/', '').split('/');
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
	return { ...crew, agents: crewAgents };
}

export async function updateCrew(projectId, data) {
	await delay();
	const crew = db.crews.find((c) => c.project_id === projectId);
	if (!crew) notFound('Crew');
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
	const agent = db.agents.find((a) => a.id === agentId);
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
	const agent = db.agents.find((a) => a.id === agentId);
	if (!agent) notFound('Agent');
	Object.assign(agent, data, { updated_at: now() });
	return { ...agent };
}

export async function deleteAgent(projectId, agentId) {
	await delay();
	const idx = db.agents.findIndex((a) => a.id === agentId);
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
	result.sort((a, b) => {
		const av = a[sort] ?? 0;
		const bv = b[sort] ?? 0;
		return order === 'desc' ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
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
	return {
		...issue,
		assigned_agent: assignedAgent ?? null,
		repo: repo ?? null,
		comments: issueComments,
		activity_log: issueActivity
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
	Object.assign(issue, data, { updated_at: now() });
	return { ...issue };
}

export async function approveIssue(projectId, issueId) {
	await delay();
	const issue = db.issues.find((i) => i.id === issueId && i.project_id === projectId);
	if (!issue) notFound('Issue');
	if (issue.status !== 'draft') throw new Error('Issue must be in draft status');
	issue.status = 'open';
	issue.updated_at = now();
	return { ...issue };
}

export async function discardIssue(projectId, issueId) {
	await delay();
	const issue = db.issues.find((i) => i.id === issueId && i.project_id === projectId);
	if (!issue) notFound('Issue');
	if (issue.status !== 'draft') throw new Error('Issue must be in draft status');
	const idx = db.issues.indexOf(issue);
	db.issues.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

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
	if (filters.actor_type) result = result.filter((a) => a.actor_type === filters.actor_type);
	if (filters.action) result = result.filter((a) => a.action === filters.action);
	if (filters.since) result = result.filter((a) => a.created_at >= filters.since);
	result.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
	const limit = filters.limit ?? 50;
	const offset = filters.offset ?? 0;
	return result.slice(offset, offset + limit);
}
