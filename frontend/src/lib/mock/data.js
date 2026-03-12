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
		assigned_agent_id: null,
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
		status: 'in_review',
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

	// Demo issues for Issue Detail View (UI #4)
	{
		id: 'api-auth-bug',
		project_id: 'proj-api',
		title: 'Fix authentication bug',
		description:
			'The login endpoint returns **500** when the session token is expired instead of returning **401**.\n\nThis causes the frontend to show a generic error instead of prompting the user to re-authenticate.\n\n## Steps to Reproduce\n1. Log in and obtain a session token\n2. Wait for the token to expire (or manually expire it)\n3. Make any authenticated API call\n4. Observe 500 Internal Server Error\n\n## Expected Behavior\n- Return `401 Unauthorized` with a descriptive error message\n- Frontend can then redirect to login automatically',
		status: 'in_review',
		priority: 8,
		assigned_agent_id: 'agent-alice',
		created_by: 'user',
		max_review_rounds: 3,
		current_review_round: 1,
		branch_name: 'crewdeck/a1b2-fix-authentication-bug',
		worktree_path: '/home/user/projects/api-backend/.worktrees/auth-bug',
		base_branch: 'main',
		repo_id: 'repo-api-1',
		created_at: ago(4),
		updated_at: ago(0.5)
	},
	{
		id: 'api-pagination',
		project_id: 'proj-api',
		title: 'Add pagination support',
		description:
			'Implement cursor-based pagination for all list endpoints.\n\n## Requirements\n- Use cursor-based pagination (not offset) for consistency\n- Support `limit` query param (default 20, max 100)\n- Return `next_cursor` in response envelope\n- Add pagination to: `/issues`, `/agents`, `/activity`\n\n## Technical Notes\nUse a compound cursor of `created_at` + `id` to ensure stable ordering even across timestamp ties.',
		status: 'ready',
		priority: 5,
		assigned_agent_id: 'agent-charlie',
		created_by: 'user',
		max_review_rounds: 2,
		current_review_round: 2,
		branch_name: 'crewdeck/c3d4-add-pagination-support',
		worktree_path: null,
		base_branch: 'main',
		repo_id: 'repo-api-1',
		created_at: ago(72),
		updated_at: ago(4)
	},
	{
		id: 'api-refactor-db',
		project_id: 'proj-api',
		title: 'Refactor database layer',
		description:
			'Extract database access into a dedicated repository layer to decouple business logic from raw SQL queries.\n\nThis will improve testability and make it easier to swap the storage backend in the future.',
		status: 'draft',
		priority: 3,
		assigned_agent_id: null,
		created_by: 'orchestrator',
		max_review_rounds: null,
		current_review_round: 0,
		branch_name: null,
		worktree_path: null,
		base_branch: 'main',
		repo_id: 'repo-api-1',
		created_at: ago(6),
		updated_at: ago(6)
	}
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
	},
	// api-auth-bug comments
	{
		id: 'cmt-auth-1',
		issue_id: 'api-auth-bug',
		author_type: 'orchestrator',
		author_id: null,
		content: 'Assigned Agent Alice. Expertise match: backend, API design, authentication.',
		created_at: ago(3.5)
	},
	{
		id: 'cmt-auth-2',
		issue_id: 'api-auth-bug',
		author_type: 'agent',
		author_id: 'agent-alice',
		content:
			'Investigating the auth middleware. Found that `validateSession()` throws an unhandled exception when the token is expired instead of returning `null`.\n\n**Plan:**\n1. Fix the session validator to return `null` for expired tokens\n2. Update the middleware to check for `null` and return 401\n3. Add test coverage for the expired token case',
		created_at: ago(2.5)
	},
	{
		id: 'cmt-auth-3',
		issue_id: 'api-auth-bug',
		author_type: 'agent',
		author_id: 'agent-alice',
		content:
			'Fix implemented. Updated `validateSession()` and the auth middleware. Tests added — all passing.\n\nSubmitting for review.',
		created_at: ago(1.5)
	},
	{
		id: 'cmt-auth-4',
		issue_id: 'api-auth-bug',
		author_type: 'agent',
		author_id: 'agent-bob',
		content:
			'Code looks good overall. One suggestion: consider adding a specific error code for **expired** vs **invalid** tokens so the frontend can show appropriate messaging.\n\nOtherwise, LGTM.',
		created_at: ago(0.5)
	},
	// api-pagination comments
	{
		id: 'cmt-page-1',
		issue_id: 'api-pagination',
		author_type: 'orchestrator',
		author_id: null,
		content: 'Assigned Agent Charlie. Expertise match: CI/CD, infrastructure.',
		created_at: ago(48)
	},
	{
		id: 'cmt-page-2',
		issue_id: 'api-pagination',
		author_type: 'agent',
		author_id: 'agent-charlie',
		content:
			'Starting on pagination. Will implement cursor-based approach using `created_at` + `id` as the compound cursor to ensure stable ordering even across ties.',
		created_at: ago(46)
	},
	{
		id: 'cmt-page-3',
		issue_id: 'api-pagination',
		author_type: 'agent',
		author_id: 'agent-charlie',
		content:
			'Implementation complete. All list endpoints now support `cursor` and `limit` params. Response envelope includes `next_cursor` (null when no more results). Submitting for Round 1 review.',
		created_at: ago(24)
	},
	{
		id: 'cmt-page-4',
		issue_id: 'api-pagination',
		author_type: 'agent',
		author_id: 'agent-alice',
		content:
			'Round 1 review complete. The cursor logic is correct but I\'d suggest **base64-encoding** the cursor value to avoid issues with special characters in URL parameters.\n\n**Requesting changes.**',
		created_at: ago(18)
	},
	{
		id: 'cmt-page-5',
		issue_id: 'api-pagination',
		author_type: 'agent',
		author_id: 'agent-charlie',
		content:
			'Updated: cursors are now base64-encoded. Updated tests to reflect the encoding. Submitting for Round 2 review.',
		created_at: ago(10)
	},
	{
		id: 'cmt-page-6',
		issue_id: 'api-pagination',
		author_type: 'agent',
		author_id: 'agent-alice',
		content: 'Round 2 review: looks great. Base64 encoding is clean, test coverage is thorough. **Approved.**',
		created_at: ago(6)
	},
	{
		id: 'cmt-page-7',
		issue_id: 'api-pagination',
		author_type: 'agent',
		author_id: 'agent-bob',
		content:
			'Round 2 review: LGTM. Implementation is clean and consistent across all endpoints. **Approved.**',
		created_at: ago(4)
	},
	// api-refactor-db comments
	{
		id: 'cmt-db-1',
		issue_id: 'api-refactor-db',
		author_type: 'orchestrator',
		author_id: null,
		content:
			'Proposed this issue based on code analysis. The current codebase mixes raw SQL queries directly in route handlers, making the code difficult to test and maintain.\n\n**Recommended approach:**\n- Create `src/db/repositories/` with one file per entity\n- Each repository exposes typed CRUD methods\n- Route handlers call repositories, not raw SQL\n\nAwaiting approval before assigning an agent.',
		created_at: ago(6)
	}
];

export const issue_agents = [
	// api-auth-bug: Alice (worker, active), Bob (reviewer, active)
	{
		id: 'ia-1',
		issue_id: 'api-auth-bug',
		agent_id: 'agent-alice',
		role: 'worker',
		status: 'active',
		review_order: null,
		session_id: null,
		created_at: ago(3.5),
		updated_at: ago(1.5)
	},
	{
		id: 'ia-2',
		issue_id: 'api-auth-bug',
		agent_id: 'agent-bob',
		role: 'reviewer',
		status: 'active',
		review_order: 1,
		session_id: null,
		created_at: ago(1.5),
		updated_at: ago(0.5)
	},
	// api-pagination: Charlie (worker, done), Alice (reviewer, approved), Bob (reviewer, approved)
	{
		id: 'ia-3',
		issue_id: 'api-pagination',
		agent_id: 'agent-charlie',
		role: 'worker',
		status: 'done',
		review_order: null,
		session_id: null,
		created_at: ago(48),
		updated_at: ago(10)
	},
	{
		id: 'ia-4',
		issue_id: 'api-pagination',
		agent_id: 'agent-alice',
		role: 'reviewer',
		status: 'approved',
		review_order: 1,
		session_id: null,
		created_at: ago(24),
		updated_at: ago(6)
	},
	{
		id: 'ia-5',
		issue_id: 'api-pagination',
		agent_id: 'agent-bob',
		role: 'reviewer',
		status: 'approved',
		review_order: 2,
		session_id: null,
		created_at: ago(24),
		updated_at: ago(4)
	}
];

export const issue_prs = [
	// api-8 (done) has a merged PR — demonstrates the PR panel
	{
		id: 'ipr-1',
		issue_id: 'api-8',
		repo_id: 'repo-api-1',
		pr_number: 42,
		pr_url: 'https://github.com/example/api-backend/pull/42',
		status: 'merged',
		created_at: ago(130),
		updated_at: ago(120)
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
	// === Full lifecycle of api-8 (Express server setup) ===
	{
		id: 'act-api8-1',
		project_id: 'proj-api',
		issue_id: 'api-8',
		actor_type: 'user',
		actor_id: 'user-main',
		action: 'issue.created',
		details: { title: 'Express server setup' },
		created_at: ago(168)
	},
	{
		id: 'act-api8-2',
		project_id: 'proj-api',
		issue_id: 'api-8',
		actor_type: 'orchestrator',
		actor_id: null,
		action: 'issue.priority_set',
		details: { priority: 10, reason: 'Blocking dependency for all other API issues' },
		created_at: ago(167)
	},
	{
		id: 'act-api8-3',
		project_id: 'proj-api',
		issue_id: 'api-8',
		actor_type: 'orchestrator',
		actor_id: null,
		action: 'agent.assigned',
		details: {
			agent_id: 'agent-alice',
			agent_name: 'Alice',
			reason: 'Best match for backend + Express expertise'
		},
		created_at: ago(166)
	},
	{
		id: 'act-api8-4',
		project_id: 'proj-api',
		issue_id: 'api-8',
		actor_type: 'system',
		actor_id: null,
		action: 'session.started',
		details: { session_id: 'sess-alice-8', agent_name: 'Alice' },
		created_at: ago(165)
	},
	{
		id: 'act-api8-5',
		project_id: 'proj-api',
		issue_id: 'api-8',
		actor_type: 'agent',
		actor_id: 'agent-alice',
		action: 'comment.added',
		details: {
			text: 'Setting up Express with helmet, cors, and compression middleware. Will use express-validator for input handling.'
		},
		created_at: ago(160)
	},
	{
		id: 'act-api8-6',
		project_id: 'proj-api',
		issue_id: 'api-8',
		actor_type: 'agent',
		actor_id: 'agent-alice',
		action: 'issue.status_changed',
		details: { from: 'in_progress', to: 'in_review' },
		created_at: ago(148)
	},
	{
		id: 'act-api8-7',
		project_id: 'proj-api',
		issue_id: 'api-8',
		actor_type: 'orchestrator',
		actor_id: null,
		action: 'review.requested',
		details: {
			reviewer_id: 'agent-bob',
			reviewer_name: 'Bob',
			reason: 'Security review needed for middleware configuration'
		},
		created_at: ago(147)
	},
	{
		id: 'act-api8-8',
		project_id: 'proj-api',
		issue_id: 'api-8',
		actor_type: 'agent',
		actor_id: 'agent-bob',
		action: 'review.comment',
		details: {
			text: 'CORS origin is set to * — this should be restricted to known domains. Also consider adding rate limiting at the middleware level.'
		},
		created_at: ago(145)
	},
	{
		id: 'act-api8-9',
		project_id: 'proj-api',
		issue_id: 'api-8',
		actor_type: 'agent',
		actor_id: 'agent-bob',
		action: 'issue.status_changed',
		details: { from: 'in_review', to: 'feedback' },
		created_at: ago(144)
	},
	{
		id: 'act-api8-10',
		project_id: 'proj-api',
		issue_id: 'api-8',
		actor_type: 'agent',
		actor_id: 'agent-alice',
		action: 'comment.added',
		details: {
			text: 'Addressed: restricted CORS to ALLOWED_ORIGINS env var, added express-rate-limit as base middleware.'
		},
		created_at: ago(138)
	},
	{
		id: 'act-api8-11',
		project_id: 'proj-api',
		issue_id: 'api-8',
		actor_type: 'agent',
		actor_id: 'agent-alice',
		action: 'issue.status_changed',
		details: { from: 'feedback', to: 'in_review' },
		created_at: ago(137)
	},
	{
		id: 'act-api8-12',
		project_id: 'proj-api',
		issue_id: 'api-8',
		actor_type: 'agent',
		actor_id: 'agent-bob',
		action: 'review.approved',
		details: { comment: 'CORS and rate limiting look good. LGTM.' },
		created_at: ago(135)
	},
	{
		id: 'act-api8-13',
		project_id: 'proj-api',
		issue_id: 'api-8',
		actor_type: 'orchestrator',
		actor_id: null,
		action: 'issue.status_changed',
		details: { from: 'in_review', to: 'ready' },
		created_at: ago(134)
	},
	{
		id: 'act-api8-14',
		project_id: 'proj-api',
		issue_id: 'api-8',
		actor_type: 'user',
		actor_id: 'user-main',
		action: 'pr.created',
		details: { pr_number: 8, branch: 'api/issue-8-express', title: 'feat: Express server setup with security middleware' },
		created_at: ago(131)
	},
	{
		id: 'act-api8-15',
		project_id: 'proj-api',
		issue_id: 'api-8',
		actor_type: 'system',
		actor_id: null,
		action: 'pr.merged',
		details: { pr_number: 8, branch: 'api/issue-8-express' },
		created_at: ago(120)
	},
	// === api-3 (REST API CRUD) — in progress ===
	{
		id: 'act-api3-1',
		project_id: 'proj-api',
		issue_id: 'api-3',
		actor_type: 'orchestrator',
		actor_id: null,
		action: 'agent.assigned',
		details: { agent_id: 'agent-alice', agent_name: 'Alice', reason: 'API design expertise required' },
		created_at: ago(71)
	},
	{
		id: 'act-api3-2',
		project_id: 'proj-api',
		issue_id: 'api-3',
		actor_type: 'system',
		actor_id: null,
		action: 'session.started',
		details: { session_id: 'sess-alice-3', agent_name: 'Alice' },
		created_at: ago(70)
	},
	{
		id: 'act-api3-3',
		project_id: 'proj-api',
		issue_id: 'api-3',
		actor_type: 'agent',
		actor_id: 'agent-alice',
		action: 'comment.added',
		details: {
			text: 'Starting with projects CRUD. Will implement RESTful routes with proper error handling and pagination.'
		},
		created_at: ago(68)
	},
	// === api-5 (OpenAPI spec) — proposed by orchestrator ===
	{
		id: 'act-api5-1',
		project_id: 'proj-api',
		issue_id: 'api-5',
		actor_type: 'orchestrator',
		actor_id: null,
		action: 'issue.created',
		details: {
			title: 'OpenAPI spec documentation',
			note: 'Proposed based on API maturity analysis — routes are stable enough to document'
		},
		created_at: ago(36)
	},
	{
		id: 'act-api5-2',
		project_id: 'proj-api',
		issue_id: 'api-5',
		actor_type: 'orchestrator',
		actor_id: null,
		action: 'agent.assigned',
		details: {
			agent_id: 'agent-bob',
			agent_name: 'Bob',
			reason: 'Strong familiarity with API contracts and security schemas'
		},
		created_at: ago(35)
	},
	// === mob-2 (Mobile App onboarding) ===
	{
		id: 'act-mob2-1',
		project_id: 'proj-mobile',
		issue_id: 'mob-2',
		actor_type: 'orchestrator',
		actor_id: null,
		action: 'agent.assigned',
		details: { agent_id: 'agent-dave', agent_name: 'Dave', reason: 'React Native specialist' },
		created_at: ago(72)
	}
];
