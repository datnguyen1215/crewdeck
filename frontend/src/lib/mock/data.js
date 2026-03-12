/** All mock data. Timestamps relative to now so the UI always looks fresh. */

const ago = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();

export const projects = [
	{
		id: 'proj-1',
		name: 'CrewDeck',
		description: 'AI crew management dashboard — the project managing itself.',
		max_concurrency: 3,
		max_review_rounds: 3,
		orchestrator_session_id: 'sess-orch-1',
		created_at: ago(168),
		updated_at: ago(2)
	},
	{
		id: 'proj-2',
		name: 'Automata',
		description: 'Automated code generation and testing pipeline.',
		max_concurrency: 2,
		max_review_rounds: 2,
		orchestrator_session_id: null,
		created_at: ago(336),
		updated_at: ago(24)
	}
];

export const repos = [
	{
		id: 'repo-1',
		project_id: 'proj-1',
		github_url: 'https://github.com/datnguyen1215/crewdeck',
		name: 'crewdeck',
		owner: 'datnguyen1215',
		local_path: '/home/user/projects/crewdeck',
		default_branch: 'main',
		created_at: ago(168)
	},
	{
		id: 'repo-2',
		project_id: 'proj-2',
		github_url: 'https://github.com/datnguyen1215/automata',
		name: 'automata',
		owner: 'datnguyen1215',
		local_path: '/home/user/projects/automata',
		default_branch: 'main',
		created_at: ago(336)
	}
];

export const crews = [
	{
		id: 'crew-1',
		project_id: 'proj-1',
		name: 'Core Team',
		created_at: ago(168),
		updated_at: ago(48)
	},
	{
		id: 'crew-2',
		project_id: 'proj-2',
		name: 'Automation Squad',
		created_at: ago(336),
		updated_at: ago(24)
	}
];

export const agents = [
	{
		id: 'agent-alice',
		crew_id: 'crew-1',
		name: 'Alice',
		role: 'Senior Software Engineer',
		expertise: ['backend', 'API design', 'databases'],
		system_prompt: 'You are Alice, a senior software engineer specializing in backend systems...',
		can_review: true,
		created_at: ago(168),
		updated_at: ago(48)
	},
	{
		id: 'agent-bob',
		crew_id: 'crew-1',
		name: 'Bob',
		role: 'Frontend Engineer',
		expertise: ['UI', 'Svelte', 'CSS', 'accessibility'],
		system_prompt: 'You are Bob, a frontend engineer with a sharp eye for UX and accessibility...',
		can_review: true,
		created_at: ago(144),
		updated_at: ago(6)
	},
	{
		id: 'agent-carol',
		crew_id: 'crew-1',
		name: 'Carol',
		role: 'Security Analyst',
		expertise: ['security', 'OWASP', 'code review', 'penetration testing'],
		system_prompt: 'You are Carol, a security analyst focused on OWASP top 10 and secure coding...',
		can_review: true,
		created_at: ago(120),
		updated_at: ago(72)
	},
	{
		id: 'agent-dave',
		crew_id: 'crew-2',
		name: 'Dave',
		role: 'DevOps Engineer',
		expertise: ['CI/CD', 'Docker', 'GitHub Actions', 'automation'],
		system_prompt: 'You are Dave, a DevOps engineer focused on automation pipelines...',
		can_review: false,
		created_at: ago(336),
		updated_at: ago(24)
	}
];

export const issues = [
	{
		id: 'issue-1',
		project_id: 'proj-1',
		title: 'UI #1: Project Scaffolding, Design System + Mock Data Layer',
		description: 'Set up the SvelteKit project with Tailwind CSS, establish the dark design system...',
		status: 'in_progress',
		priority: 10,
		assigned_agent_id: 'agent-bob',
		created_by: 'user',
		max_review_rounds: null,
		current_review_round: 0,
		branch_name: 'crewdeck/issue-1-scaffolding',
		worktree_path: '/home/user/projects/crewdeck/.worktrees/issue-1',
		base_branch: 'main',
		repo_id: 'repo-1',
		created_at: ago(48),
		updated_at: ago(3)
	},
	{
		id: 'issue-2',
		project_id: 'proj-1',
		title: 'UI #2: Project List + Issue Board',
		description: 'Build the project list page and the kanban-style issue board...',
		status: 'open',
		priority: 8,
		assigned_agent_id: null,
		created_by: 'user',
		max_review_rounds: null,
		current_review_round: 0,
		branch_name: null,
		worktree_path: null,
		base_branch: 'main',
		repo_id: 'repo-1',
		created_at: ago(24),
		updated_at: ago(24)
	},
	{
		id: 'issue-3',
		project_id: 'proj-1',
		title: 'Backend: REST API server foundation',
		description: 'Initialize the Node.js backend with Express, SQLite, and base middleware...',
		status: 'in_review',
		priority: 9,
		assigned_agent_id: 'agent-alice',
		created_by: 'user',
		max_review_rounds: 3,
		current_review_round: 1,
		branch_name: 'crewdeck/issue-3-api-foundation',
		worktree_path: '/home/user/projects/crewdeck/.worktrees/issue-3',
		base_branch: 'main',
		repo_id: 'repo-1',
		created_at: ago(72),
		updated_at: ago(1)
	},
	{
		id: 'issue-4',
		project_id: 'proj-1',
		title: 'Database: SQLite schema and migrations',
		description: 'Define the full SQLite schema from the data model doc, set up migrations...',
		status: 'done',
		priority: 7,
		assigned_agent_id: 'agent-alice',
		created_by: 'user',
		max_review_rounds: null,
		current_review_round: 2,
		branch_name: 'crewdeck/issue-4-schema',
		worktree_path: null,
		base_branch: 'main',
		repo_id: 'repo-1',
		created_at: ago(120),
		updated_at: ago(48)
	},
	{
		id: 'issue-5',
		project_id: 'proj-1',
		title: 'Security: Add input validation and sanitization',
		description: 'All API endpoints need proper input validation using zod or similar...',
		status: 'draft',
		priority: 0,
		assigned_agent_id: null,
		created_by: 'orchestrator',
		max_review_rounds: null,
		current_review_round: 0,
		branch_name: null,
		worktree_path: null,
		base_branch: 'main',
		repo_id: null,
		created_at: ago(6),
		updated_at: ago(6)
	},
	{
		id: 'issue-6',
		project_id: 'proj-2',
		title: 'CI: GitHub Actions workflow for automated testing',
		description: 'Set up automated test runs on every PR using GitHub Actions...',
		status: 'ready',
		priority: 9,
		assigned_agent_id: 'agent-dave',
		created_by: 'user',
		max_review_rounds: null,
		current_review_round: 1,
		branch_name: 'automata/issue-6-ci',
		worktree_path: null,
		base_branch: 'main',
		repo_id: 'repo-2',
		created_at: ago(48),
		updated_at: ago(4)
	}
];

export const comments = [
	{
		id: 'comment-1',
		issue_id: 'issue-3',
		author_type: 'agent',
		author_id: 'agent-alice',
		content: 'Completed the Express server setup with all base middleware. SQLite connection established via better-sqlite3. All 12 CRUD endpoints are wired up and returning the correct shapes.',
		created_at: ago(8)
	},
	{
		id: 'comment-2',
		issue_id: 'issue-3',
		author_type: 'agent',
		author_id: 'agent-carol',
		content: 'Review in progress. Found two issues:\n1. The `/projects` endpoint doesn\'t sanitize the `sort` query param — potential injection vector.\n2. Error responses leak stack traces in development mode but need a production guard.',
		created_at: ago(2)
	},
	{
		id: 'comment-3',
		issue_id: 'issue-3',
		author_type: 'orchestrator',
		author_id: null,
		content: 'Carol has posted review feedback. Alice, please address the two issues raised before this can move to ready status.',
		created_at: ago(1)
	},
	{
		id: 'comment-4',
		issue_id: 'issue-1',
		author_type: 'agent',
		author_id: 'agent-bob',
		content: 'Starting work on the SvelteKit scaffolding. Will set up Tailwind v4 with the command-center theme first, then wire up the mock data layer.',
		created_at: ago(3)
	},
	{
		id: 'comment-5',
		issue_id: 'issue-5',
		author_type: 'orchestrator',
		author_id: null,
		content: 'Proposed this issue based on the security gaps identified during Carol\'s review of issue-3. Awaiting human approval to add to the queue.',
		created_at: ago(6)
	}
];

export const sessions = [
	{
		id: 'sess-orch-1',
		project_id: 'proj-1',
		session_type: 'orchestrator',
		agent_id: null,
		issue_id: null,
		tmux_session_name: 'crewdeck-orch-proj-1',
		tmux_pane_id: '%0',
		status: 'idle',
		created_at: ago(168),
		updated_at: ago(6)
	},
	{
		id: 'sess-bob-1',
		project_id: 'proj-1',
		session_type: 'worker',
		agent_id: 'agent-bob',
		issue_id: 'issue-1',
		tmux_session_name: 'crewdeck-bob-issue-1',
		tmux_pane_id: '%3',
		status: 'running',
		created_at: ago(3),
		updated_at: ago(0.1)
	},
	{
		id: 'sess-alice-3',
		project_id: 'proj-1',
		session_type: 'worker',
		agent_id: 'agent-alice',
		issue_id: 'issue-3',
		tmux_session_name: 'crewdeck-alice-issue-3',
		tmux_pane_id: '%1',
		status: 'completed',
		created_at: ago(12),
		updated_at: ago(8)
	},
	{
		id: 'sess-carol-3',
		project_id: 'proj-1',
		session_type: 'reviewer',
		agent_id: 'agent-carol',
		issue_id: 'issue-3',
		tmux_session_name: 'crewdeck-carol-issue-3-review',
		tmux_pane_id: '%2',
		status: 'completed',
		created_at: ago(3),
		updated_at: ago(2)
	}
];

export const activity = [
	{
		id: 'act-1',
		project_id: 'proj-1',
		issue_id: 'issue-4',
		actor_type: 'user',
		actor_id: null,
		action: 'issue.created',
		details: { title: 'Database: SQLite schema and migrations' },
		created_at: ago(120)
	},
	{
		id: 'act-2',
		project_id: 'proj-1',
		issue_id: 'issue-4',
		actor_type: 'orchestrator',
		actor_id: null,
		action: 'agent.assigned',
		details: { agent_id: 'agent-alice', agent_name: 'Alice' },
		created_at: ago(119)
	},
	{
		id: 'act-3',
		project_id: 'proj-1',
		issue_id: 'issue-4',
		actor_type: 'system',
		actor_id: null,
		action: 'session.started',
		details: { session_id: 'sess-alice-4', agent_id: 'agent-alice' },
		created_at: ago(118)
	},
	{
		id: 'act-4',
		project_id: 'proj-1',
		issue_id: 'issue-4',
		actor_type: 'agent',
		actor_id: 'agent-alice',
		action: 'issue.status_changed',
		details: { from: 'in_progress', to: 'in_review' },
		created_at: ago(80)
	},
	{
		id: 'act-5',
		project_id: 'proj-1',
		issue_id: 'issue-4',
		actor_type: 'agent',
		actor_id: 'agent-carol',
		action: 'issue.status_changed',
		details: { from: 'in_review', to: 'ready' },
		created_at: ago(60)
	},
	{
		id: 'act-6',
		project_id: 'proj-1',
		issue_id: 'issue-3',
		actor_type: 'user',
		actor_id: null,
		action: 'issue.created',
		details: { title: 'Backend: REST API server foundation' },
		created_at: ago(72)
	},
	{
		id: 'act-7',
		project_id: 'proj-1',
		issue_id: 'issue-3',
		actor_type: 'orchestrator',
		actor_id: null,
		action: 'agent.assigned',
		details: { agent_id: 'agent-alice', agent_name: 'Alice' },
		created_at: ago(71)
	},
	{
		id: 'act-8',
		project_id: 'proj-1',
		issue_id: 'issue-3',
		actor_type: 'agent',
		actor_id: 'agent-alice',
		action: 'issue.status_changed',
		details: { from: 'in_progress', to: 'in_review' },
		created_at: ago(8)
	},
	{
		id: 'act-9',
		project_id: 'proj-1',
		issue_id: 'issue-1',
		actor_type: 'user',
		actor_id: null,
		action: 'issue.created',
		details: { title: 'UI #1: Project Scaffolding' },
		created_at: ago(48)
	},
	{
		id: 'act-10',
		project_id: 'proj-1',
		issue_id: 'issue-5',
		actor_type: 'orchestrator',
		actor_id: null,
		action: 'issue.created',
		details: { title: 'Security: Add input validation and sanitization', status: 'draft' },
		created_at: ago(6)
	}
];
