/** All mock data. Timestamps relative to now so the UI always looks fresh. */

const ago = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();

export const projects = [
	{
		id: 'proj-api',
		name: 'API Backend',
		description: 'Core API services and authentication',
		max_concurrency: 3,
		max_review_rounds: 3,
		orchestrator_session_id: 'sess-orch-api',
		created_at: ago(168),
		updated_at: ago(2)
	},
	{
		id: 'proj-mobile',
		name: 'Mobile App',
		description: 'React Native mobile application',
		max_concurrency: 2,
		max_review_rounds: 3,
		orchestrator_session_id: 'sess-orch-mobile',
		created_at: ago(336),
		updated_at: ago(24)
	},
	{
		id: 'proj-docs',
		name: 'Documentation Site',
		description: null,
		max_concurrency: 1,
		max_review_rounds: 3,
		orchestrator_session_id: 'sess-orch-docs',
		created_at: ago(72),
		updated_at: ago(48)
	}
];

export const repos = [
	{
		id: 'repo-api-1',
		project_id: 'proj-api',
		github_url: 'https://github.com/example/api-backend',
		name: 'api-backend',
		owner: 'example',
		local_path: '/home/user/projects/api-backend',
		default_branch: 'main',
		created_at: ago(168)
	},
	{
		id: 'repo-api-2',
		project_id: 'proj-api',
		github_url: 'https://github.com/example/api-infra',
		name: 'api-infra',
		owner: 'example',
		local_path: '/home/user/projects/api-infra',
		default_branch: 'main',
		created_at: ago(144)
	},
	{
		id: 'repo-mobile-1',
		project_id: 'proj-mobile',
		github_url: 'https://github.com/example/mobile-app',
		name: 'mobile-app',
		owner: 'example',
		local_path: '/home/user/projects/mobile-app',
		default_branch: 'main',
		created_at: ago(336)
	},
	{
		id: 'repo-docs-1',
		project_id: 'proj-docs',
		github_url: 'https://github.com/example/docs-site',
		name: 'docs-site',
		owner: 'example',
		local_path: '/home/user/projects/docs-site',
		default_branch: 'main',
		created_at: ago(72)
	}
];

export const crews = [
	{
		id: 'crew-api',
		project_id: 'proj-api',
		name: 'API Team',
		created_at: ago(168),
		updated_at: ago(2)
	},
	{
		id: 'crew-mobile',
		project_id: 'proj-mobile',
		name: 'Mobile Team',
		created_at: ago(336),
		updated_at: ago(24)
	},
	{
		id: 'crew-docs',
		project_id: 'proj-docs',
		name: 'Docs Team',
		created_at: ago(72),
		updated_at: ago(48)
	}
];

export const agents = [
	{
		id: 'agent-alice',
		crew_id: 'crew-api',
		name: 'Alice',
		role: 'Senior Backend Engineer',
		expertise: ['backend', 'API design', 'databases'],
		system_prompt: 'You are Alice, a senior backend engineer specializing in API systems.',
		can_review: true,
		created_at: ago(168),
		updated_at: ago(2)
	},
	{
		id: 'agent-bob',
		crew_id: 'crew-api',
		name: 'Bob',
		role: 'Security Engineer',
		expertise: ['security', 'OWASP', 'auth'],
		system_prompt: 'You are Bob, a security engineer focused on API security.',
		can_review: true,
		created_at: ago(144),
		updated_at: ago(6)
	},
	{
		id: 'agent-charlie',
		crew_id: 'crew-api',
		name: 'Charlie',
		role: 'DevOps Engineer',
		expertise: ['CI/CD', 'Docker', 'infrastructure'],
		system_prompt: 'You are Charlie, a DevOps engineer focused on deployments.',
		can_review: false,
		created_at: ago(120),
		updated_at: ago(12)
	},
	{
		id: 'agent-dave',
		crew_id: 'crew-mobile',
		name: 'Dave',
		role: 'React Native Engineer',
		expertise: ['React Native', 'mobile', 'iOS', 'Android'],
		system_prompt: 'You are Dave, a React Native engineer.',
		can_review: true,
		created_at: ago(336),
		updated_at: ago(24)
	},
	{
		id: 'agent-eve',
		crew_id: 'crew-mobile',
		name: 'Eve',
		role: 'Mobile QA Engineer',
		expertise: ['testing', 'automation', 'mobile QA'],
		system_prompt: 'You are Eve, a mobile QA engineer.',
		can_review: true,
		created_at: ago(300),
		updated_at: ago(48)
	},
	{
		id: 'agent-frank',
		crew_id: 'crew-docs',
		name: 'Frank',
		role: 'Technical Writer',
		expertise: ['documentation', 'markdown', 'tutorials'],
		system_prompt: 'You are Frank, a technical writer.',
		can_review: false,
		created_at: ago(72),
		updated_at: ago(48)
	}
];

export const issues = [
	// proj-api: 2 open
	{
		id: 'api-1',
		project_id: 'proj-api',
		title: 'Add rate limiting middleware',
		description: 'Implement per-IP rate limiting on all public API endpoints.',
		status: 'open',
		priority: 8,
		assigned_agent_id: null,
		created_by: 'user',
		max_review_rounds: null,
		current_review_round: 0,
		branch_name: null,
		worktree_path: null,
		base_branch: 'main',
		repo_id: 'repo-api-1',
		created_at: ago(24),
		updated_at: ago(24)
	},
	{
		id: 'api-2',
		project_id: 'proj-api',
		title: 'JWT refresh token rotation',
		description: 'Implement secure refresh token rotation to prevent token reuse attacks.',
		status: 'open',
		priority: 7,
		assigned_agent_id: null,
		created_by: 'user',
		max_review_rounds: null,
		current_review_round: 0,
		branch_name: null,
		worktree_path: null,
		base_branch: 'main',
		repo_id: 'repo-api-1',
		created_at: ago(18),
		updated_at: ago(18)
	},
	// proj-api: 3 in_progress
	{
		id: 'api-3',
		project_id: 'proj-api',
		title: 'REST API CRUD endpoints',
		description: 'Implement full CRUD for projects, repos, agents, and issues.',
		status: 'in_progress',
		priority: 10,
		assigned_agent_id: 'agent-alice',
		created_by: 'user',
		max_review_rounds: 3,
		current_review_round: 0,
		branch_name: 'api/issue-3-crud',
		worktree_path: '/home/user/projects/api-backend/.worktrees/issue-3',
		base_branch: 'main',
		repo_id: 'repo-api-1',
		created_at: ago(72),
		updated_at: ago(3)
	},
	{
		id: 'api-4',
		project_id: 'proj-api',
		title: 'SQLite schema migrations',
		description: 'Create migration system for schema evolution.',
		status: 'in_progress',
		priority: 9,
		assigned_agent_id: 'agent-charlie',
		created_by: 'user',
		max_review_rounds: 2,
		current_review_round: 0,
		branch_name: 'api/issue-4-migrations',
		worktree_path: '/home/user/projects/api-backend/.worktrees/issue-4',
		base_branch: 'main',
		repo_id: 'repo-api-1',
		created_at: ago(48),
		updated_at: ago(5)
	},
	{
		id: 'api-5',
		project_id: 'proj-api',
		title: 'OpenAPI spec documentation',
		description: 'Generate and serve OpenAPI 3.0 spec from route definitions.',
		status: 'in_progress',
		priority: 6,
		assigned_agent_id: 'agent-bob',
		created_by: 'orchestrator',
		max_review_rounds: 2,
		current_review_round: 0,
		branch_name: 'api/issue-5-openapi',
		worktree_path: '/home/user/projects/api-backend/.worktrees/issue-5',
		base_branch: 'main',
		repo_id: 'repo-api-1',
		created_at: ago(36),
		updated_at: ago(1)
	},
	// proj-api: 1 in_review
	{
		id: 'api-6',
		project_id: 'proj-api',
		title: 'Input validation with Zod',
		description: 'Add Zod schema validation to all API request bodies.',
		status: 'in_review',
		priority: 8,
		assigned_agent_id: 'agent-alice',
		created_by: 'user',
		max_review_rounds: 3,
		current_review_round: 1,
		branch_name: 'api/issue-6-validation',
		worktree_path: null,
		base_branch: 'main',
		repo_id: 'repo-api-1',
		created_at: ago(96),
		updated_at: ago(8)
	},
	// proj-api: 1 ready
	{
		id: 'api-7',
		project_id: 'proj-api',
		title: 'Request logging middleware',
		description: 'Structured JSON request/response logging with correlation IDs.',
		status: 'ready',
		priority: 5,
		assigned_agent_id: 'agent-charlie',
		created_by: 'user',
		max_review_rounds: 2,
		current_review_round: 2,
		branch_name: 'api/issue-7-logging',
		worktree_path: null,
		base_branch: 'main',
		repo_id: 'repo-api-1',
		created_at: ago(120),
		updated_at: ago(12)
	},
	// proj-api: 5 done
	{
		id: 'api-8',
		project_id: 'proj-api',
		title: 'Express server setup',
		description: 'Initialize Express with base middleware stack.',
		status: 'done',
		priority: 10,
		assigned_agent_id: 'agent-alice',
		created_by: 'user',
		max_review_rounds: 2,
		current_review_round: 1,
		branch_name: 'api/issue-8-express',
		worktree_path: null,
		base_branch: 'main',
		repo_id: 'repo-api-1',
		created_at: ago(168),
		updated_at: ago(120)
	},
	{
		id: 'api-9',
		project_id: 'proj-api',
		title: 'CORS configuration',
		description: 'Configure CORS for cross-origin API access.',
		status: 'done',
		priority: 8,
		assigned_agent_id: 'agent-bob',
		created_by: 'user',
		max_review_rounds: 1,
		current_review_round: 1,
		branch_name: 'api/issue-9-cors',
		worktree_path: null,
		base_branch: 'main',
		repo_id: 'repo-api-1',
		created_at: ago(156),
		updated_at: ago(144)
	},
	{
		id: 'api-10',
		project_id: 'proj-api',
		title: 'Health check endpoint',
		description: 'Add /health endpoint returning service status.',
		status: 'done',
		priority: 7,
		assigned_agent_id: 'agent-alice',
		created_by: 'user',
		max_review_rounds: 1,
		current_review_round: 1,
		branch_name: 'api/issue-10-health',
		worktree_path: null,
		base_branch: 'main',
		repo_id: 'repo-api-1',
		created_at: ago(144),
		updated_at: ago(132)
	},
	{
		id: 'api-11',
		project_id: 'proj-api',
		title: 'Database connection pool',
		description: 'Configure SQLite connection with better-sqlite3.',
		status: 'done',
		priority: 9,
		assigned_agent_id: 'agent-charlie',
		created_by: 'user',
		max_review_rounds: 2,
		current_review_round: 1,
		branch_name: 'api/issue-11-db',
		worktree_path: null,
		base_branch: 'main',
		repo_id: 'repo-api-1',
		created_at: ago(160),
		updated_at: ago(148)
	},
	{
		id: 'api-12',
		project_id: 'proj-api',
		title: 'Error handling middleware',
		description: 'Global error handler with structured error responses.',
		status: 'done',
		priority: 8,
		assigned_agent_id: 'agent-alice',
		created_by: 'user',
		max_review_rounds: 2,
		current_review_round: 2,
		branch_name: 'api/issue-12-errors',
		worktree_path: null,
		base_branch: 'main',
		repo_id: 'repo-api-1',
		created_at: ago(152),
		updated_at: ago(140)
	},
	// proj-mobile: 1 open
	{
		id: 'mob-1',
		project_id: 'proj-mobile',
		title: 'Push notification setup',
		description: 'Integrate Firebase Cloud Messaging for push notifications.',
		status: 'open',
		priority: 7,
		assigned_agent_id: null,
		created_by: 'user',
		max_review_rounds: null,
		current_review_round: 0,
		branch_name: null,
		worktree_path: null,
		base_branch: 'main',
		repo_id: 'repo-mobile-1',
		created_at: ago(48),
		updated_at: ago(48)
	},
	// proj-mobile: 1 in_progress
	{
		id: 'mob-2',
		project_id: 'proj-mobile',
		title: 'Authentication screens',
		description: 'Login, register, and password reset screens.',
		status: 'in_progress',
		priority: 9,
		assigned_agent_id: 'agent-dave',
		created_by: 'user',
		max_review_rounds: 2,
		current_review_round: 0,
		branch_name: 'mobile/issue-2-auth',
		worktree_path: '/home/user/projects/mobile-app/.worktrees/issue-2',
		base_branch: 'main',
		repo_id: 'repo-mobile-1',
		created_at: ago(72),
		updated_at: ago(4)
	},
	// proj-mobile: 2 done
	{
		id: 'mob-3',
		project_id: 'proj-mobile',
		title: 'React Native project init',
		description: 'Bootstrap RN project with Expo and TypeScript.',
		status: 'done',
		priority: 10,
		assigned_agent_id: 'agent-dave',
		created_by: 'user',
		max_review_rounds: 1,
		current_review_round: 1,
		branch_name: 'mobile/issue-3-init',
		worktree_path: null,
		base_branch: 'main',
		repo_id: 'repo-mobile-1',
		created_at: ago(336),
		updated_at: ago(312)
	},
	{
		id: 'mob-4',
		project_id: 'proj-mobile',
		title: 'Navigation setup',
		description: 'Configure React Navigation with tab and stack navigators.',
		status: 'done',
		priority: 9,
		assigned_agent_id: 'agent-eve',
		created_by: 'user',
		max_review_rounds: 2,
		current_review_round: 2,
		branch_name: 'mobile/issue-4-nav',
		worktree_path: null,
		base_branch: 'main',
		repo_id: 'repo-mobile-1',
		created_at: ago(300),
		updated_at: ago(288)
	}
	// proj-docs: 0 issues
];

export const comments = [
	{
		id: 'comment-1',
		issue_id: 'api-3',
		author_type: 'agent',
		author_id: 'agent-alice',
		content:
			'Working on the CRUD endpoints. Projects and repos are done, now wiring up agents and issues.',
		created_at: ago(3)
	},
	{
		id: 'comment-2',
		issue_id: 'api-6',
		author_type: 'agent',
		author_id: 'agent-bob',
		content:
			'Review complete. Two minor issues: error messages expose internal field names, and the email validator allows +tags which should be permitted per spec.',
		created_at: ago(8)
	},
	{
		id: 'comment-3',
		issue_id: 'mob-2',
		author_type: 'agent',
		author_id: 'agent-dave',
		content: 'Login and register screens complete. Working on the password reset flow.',
		created_at: ago(4)
	}
];

export const sessions = [
	{
		id: 'sess-orch-api',
		project_id: 'proj-api',
		session_type: 'orchestrator',
		agent_id: null,
		issue_id: null,
		tmux_session_name: 'crewdeck-orch-api',
		tmux_pane_id: '%0',
		status: 'running',
		created_at: ago(168),
		updated_at: ago(0.5)
	},
	{
		id: 'sess-orch-mobile',
		project_id: 'proj-mobile',
		session_type: 'orchestrator',
		agent_id: null,
		issue_id: null,
		tmux_session_name: 'crewdeck-orch-mobile',
		tmux_pane_id: '%4',
		status: 'idle',
		created_at: ago(336),
		updated_at: ago(24)
	},
	{
		id: 'sess-orch-docs',
		project_id: 'proj-docs',
		session_type: 'orchestrator',
		agent_id: null,
		issue_id: null,
		tmux_session_name: 'crewdeck-orch-docs',
		tmux_pane_id: '%8',
		status: 'idle',
		created_at: ago(72),
		updated_at: ago(48)
	},
	{
		id: 'sess-alice-3',
		project_id: 'proj-api',
		session_type: 'worker',
		agent_id: 'agent-alice',
		issue_id: 'api-3',
		tmux_session_name: 'crewdeck-alice-api-3',
		tmux_pane_id: '%1',
		status: 'running',
		created_at: ago(3),
		updated_at: ago(0.1)
	},
	{
		id: 'sess-charlie-4',
		project_id: 'proj-api',
		session_type: 'worker',
		agent_id: 'agent-charlie',
		issue_id: 'api-4',
		tmux_session_name: 'crewdeck-charlie-api-4',
		tmux_pane_id: '%2',
		status: 'running',
		created_at: ago(5),
		updated_at: ago(0.2)
	},
	{
		id: 'sess-dave-mob-2',
		project_id: 'proj-mobile',
		session_type: 'worker',
		agent_id: 'agent-dave',
		issue_id: 'mob-2',
		tmux_session_name: 'crewdeck-dave-mob-2',
		tmux_pane_id: '%5',
		status: 'completed',
		created_at: ago(4),
		updated_at: ago(0.5)
	}
];

export const activity = [
	{
		id: 'act-1',
		project_id: 'proj-api',
		issue_id: 'api-8',
		actor_type: 'agent',
		actor_id: 'agent-alice',
		action: 'issue.status_changed',
		details: { from: 'in_review', to: 'done' },
		created_at: ago(120)
	},
	{
		id: 'act-2',
		project_id: 'proj-api',
		issue_id: 'api-3',
		actor_type: 'orchestrator',
		actor_id: null,
		action: 'agent.assigned',
		details: { agent_id: 'agent-alice', agent_name: 'Alice' },
		created_at: ago(71)
	},
	{
		id: 'act-3',
		project_id: 'proj-mobile',
		issue_id: 'mob-2',
		actor_type: 'orchestrator',
		actor_id: null,
		action: 'agent.assigned',
		details: { agent_id: 'agent-dave', agent_name: 'Dave' },
		created_at: ago(72)
	}
];
