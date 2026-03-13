/**
 * Mock terminal session data and streaming utility.
 * Simulates WebSocket session.output events that the real backend will provide.
 */

/**
 * @typedef {{ text: string; delayMs: number }} OutputLine
 * @typedef {{ sessionId: string; agentName: string; status: 'running' | 'completed' | 'idle'; outputLines: OutputLine[] }} MockTerminalSession
 */

/** Pre-built mock scenarios keyed by issue id */
export const mockSessions = {
	'api-3': {
		sessionId: 'sess-alice-3',
		agentName: 'Alice',
		status: 'running',
		outputLines: [
			{ text: '$ claude --prompt "Implement REST API CRUD endpoints" --project api-backend', delayMs: 0 },
			{ text: '', delayMs: 300 },
			{ text: '\x1b[36mReading project structure...\x1b[0m', delayMs: 500 },
			{ text: '  src/routes/', delayMs: 200 },
			{ text: '  src/db/', delayMs: 100 },
			{ text: '  src/middleware/', delayMs: 100 },
			{ text: '', delayMs: 400 },
			{ text: '\x1b[36mAnalyzing existing code patterns...\x1b[0m', delayMs: 600 },
			{ text: 'Reading src/routes/projects.js...', delayMs: 300 },
			{ text: 'Reading src/db/schema.js...', delayMs: 200 },
			{ text: '', delayMs: 500 },
			{ text: '\x1b[32m✓\x1b[0m Found existing project routes, extending pattern for issues and agents', delayMs: 400 },
			{ text: '', delayMs: 300 },
			{ text: '\x1b[36mCreating src/routes/issues.js...\x1b[0m', delayMs: 700 },
			{ text: '  Writing GET /issues endpoint...', delayMs: 400 },
			{ text: '  Writing POST /issues endpoint...', delayMs: 300 },
			{ text: '  Writing GET /issues/:id endpoint...', delayMs: 300 },
			{ text: '  Writing PUT /issues/:id endpoint...', delayMs: 300 },
			{ text: '  Writing DELETE /issues/:id endpoint...', delayMs: 300 },
			{ text: '\x1b[32m✓\x1b[0m Issues CRUD complete', delayMs: 200 },
			{ text: '', delayMs: 400 },
			{ text: '\x1b[36mCreating src/routes/agents.js...\x1b[0m', delayMs: 500 },
			{ text: '  Writing GET /agents endpoint...', delayMs: 350 },
			{ text: '  Writing POST /agents endpoint...', delayMs: 300 },
			{ text: '  Writing GET /agents/:id endpoint...', delayMs: 300 },
			{ text: '\x1b[32m✓\x1b[0m Agents CRUD complete', delayMs: 200 },
			{ text: '', delayMs: 400 },
			{ text: '\x1b[36mRunning tests...\x1b[0m', delayMs: 800 },
			{ text: '  PASS  src/routes/projects.test.js (12 tests)', delayMs: 500 },
			{ text: '  PASS  src/routes/issues.test.js (18 tests)', delayMs: 400 },
			{ text: '  PASS  src/routes/agents.test.js (14 tests)', delayMs: 400 },
			{ text: '', delayMs: 200 },
			{ text: '\x1b[32m✓\x1b[0m 44/44 tests passed', delayMs: 300 },
			{ text: '', delayMs: 500 },
			{ text: '\x1b[36mCommitting changes...\x1b[0m', delayMs: 400 },
			{ text: 'git add src/routes/issues.js src/routes/agents.js', delayMs: 200 },
			{ text: 'git commit -m "feat: add CRUD endpoints for issues and agents"', delayMs: 300 },
			{ text: '\x1b[32m✓\x1b[0m Changes committed on branch api/issue-3-crud', delayMs: 300 },
			{ text: '', delayMs: 600 },
			{ text: '\x1b[33mWorking on project CRUD next...\x1b[0m', delayMs: 0 },
		]
	},

	'api-4': {
		sessionId: 'sess-charlie-4',
		agentName: 'Charlie',
		status: 'running',
		outputLines: [
			{ text: '$ claude --prompt "Create migration system for schema evolution" --project api-backend', delayMs: 0 },
			{ text: '', delayMs: 300 },
			{ text: '\x1b[36mReading current schema...\x1b[0m', delayMs: 500 },
			{ text: 'Reading src/db/schema.js...', delayMs: 300 },
			{ text: '', delayMs: 400 },
			{ text: '\x1b[36mDesigning migration architecture...\x1b[0m', delayMs: 800 },
			{ text: '  Strategy: sequential versioned migrations', delayMs: 300 },
			{ text: '  Storage: migrations table in SQLite', delayMs: 200 },
			{ text: '  Format: timestamp-prefixed JS files', delayMs: 200 },
			{ text: '', delayMs: 500 },
			{ text: '\x1b[36mCreating migration runner...\x1b[0m', delayMs: 600 },
			{ text: 'Writing src/db/migrate.js...', delayMs: 400 },
			{ text: '\x1b[32m✓\x1b[0m Migration runner created', delayMs: 200 },
			{ text: '', delayMs: 400 },
			{ text: '\x1b[36mCreating initial migration...\x1b[0m', delayMs: 500 },
			{ text: 'Writing migrations/001_initial_schema.js...', delayMs: 400 },
			{ text: '\x1b[32m✓\x1b[0m Initial migration created', delayMs: 200 },
			{ text: '', delayMs: 400 },
			{ text: '\x1b[36mRunning migrations on test database...\x1b[0m', delayMs: 600 },
			{ text: '  Running migration 001_initial_schema...', delayMs: 500 },
			{ text: '\x1b[32m✓\x1b[0m Migration applied successfully', delayMs: 300 },
			{ text: '', delayMs: 400 },
			{ text: '\x1b[36mRunning tests...\x1b[0m', delayMs: 800 },
			{ text: '  PASS  src/db/migrate.test.js (9 tests)', delayMs: 600 },
			{ text: '\x1b[32m✓\x1b[0m 9/9 tests passed', delayMs: 200 },
			{ text: '', delayMs: 600 },
			{ text: '\x1b[33mAdding rollback support...\x1b[0m', delayMs: 0 },
		]
	},

	'api-auth-bug': {
		sessionId: 'sess-alice-auth',
		agentName: 'Alice',
		status: 'completed',
		outputLines: [
			{ text: '$ claude --prompt "Fix authentication bug: 500 on expired token" --project api-backend', delayMs: 0 },
			{ text: '', delayMs: 200 },
			{ text: '\x1b[36mLocating auth middleware...\x1b[0m', delayMs: 400 },
			{ text: 'Reading src/auth/middleware.ts...', delayMs: 300 },
			{ text: 'Reading src/auth/session.ts...', delayMs: 200 },
			{ text: '', delayMs: 400 },
			{ text: '\x1b[31mFound issue on line 42:\x1b[0m', delayMs: 500 },
			{ text: '  validateSession() throws uncaught exception for expired tokens', delayMs: 200 },
			{ text: '  instead of returning null', delayMs: 100 },
			{ text: '', delayMs: 400 },
			{ text: '\x1b[36mEditing src/auth/session.ts...\x1b[0m', delayMs: 500 },
			{ text: '  Wrapping token decode in try/catch', delayMs: 300 },
			{ text: '  Returning null for TokenExpiredError', delayMs: 200 },
			{ text: '\x1b[32m✓\x1b[0m Applied fix to validateSession()', delayMs: 200 },
			{ text: '', delayMs: 400 },
			{ text: '\x1b[36mEditing src/auth/middleware.ts...\x1b[0m', delayMs: 500 },
			{ text: '  Adding null check after validateSession()', delayMs: 300 },
			{ text: '  Returning 401 when session is null', delayMs: 200 },
			{ text: '\x1b[32m✓\x1b[0m Auth middleware updated', delayMs: 200 },
			{ text: '', delayMs: 500 },
			{ text: '\x1b[36mAdding test coverage...\x1b[0m', delayMs: 600 },
			{ text: 'Writing src/auth/middleware.test.ts...', delayMs: 400 },
			{ text: '  Test: expired token returns 401', delayMs: 200 },
			{ text: '  Test: invalid token returns 401', delayMs: 200 },
			{ text: '  Test: valid token passes through', delayMs: 200 },
			{ text: '', delayMs: 400 },
			{ text: '\x1b[36mRunning tests...\x1b[0m', delayMs: 600 },
			{ text: '  PASS  src/auth/middleware.test.ts (11 tests)', delayMs: 500 },
			{ text: '  PASS  src/auth/session.test.ts (8 tests)', delayMs: 400 },
			{ text: '\x1b[32m✓\x1b[0m 47/47 tests passed', delayMs: 200 },
			{ text: '', delayMs: 400 },
			{ text: 'git commit -m "fix: return 401 for expired session tokens"', delayMs: 300 },
			{ text: '\x1b[32m✓\x1b[0m Fix committed and submitted for review', delayMs: 200 },
		]
	},

	'mob-2': {
		sessionId: 'sess-dave-mob-2',
		agentName: 'Dave',
		status: 'completed',
		outputLines: [
			{ text: '$ claude --prompt "Build authentication screens" --project mobile-app', delayMs: 0 },
			{ text: '', delayMs: 300 },
			{ text: '\x1b[36mReading existing navigation structure...\x1b[0m', delayMs: 500 },
			{ text: 'Reading src/navigation/AuthStack.tsx...', delayMs: 300 },
			{ text: '', delayMs: 400 },
			{ text: '\x1b[36mCreating Login screen...\x1b[0m', delayMs: 600 },
			{ text: 'Writing src/screens/LoginScreen.tsx...', delayMs: 500 },
			{ text: '\x1b[32m✓\x1b[0m Login screen created with form validation', delayMs: 200 },
			{ text: '', delayMs: 400 },
			{ text: '\x1b[36mCreating Register screen...\x1b[0m', delayMs: 500 },
			{ text: 'Writing src/screens/RegisterScreen.tsx...', delayMs: 500 },
			{ text: '\x1b[32m✓\x1b[0m Register screen created', delayMs: 200 },
			{ text: '', delayMs: 400 },
			{ text: '\x1b[36mCreating Password Reset screen...\x1b[0m', delayMs: 500 },
			{ text: 'Writing src/screens/PasswordResetScreen.tsx...', delayMs: 500 },
			{ text: '\x1b[32m✓\x1b[0m Password reset flow created', delayMs: 200 },
			{ text: '', delayMs: 400 },
			{ text: '\x1b[36mRunning tests...\x1b[0m', delayMs: 600 },
			{ text: '  PASS  src/screens/__tests__/LoginScreen.test.tsx (7 tests)', delayMs: 500 },
			{ text: '  PASS  src/screens/__tests__/RegisterScreen.test.tsx (6 tests)', delayMs: 400 },
			{ text: '\x1b[32m✓\x1b[0m 13/13 tests passed', delayMs: 200 },
			{ text: '', delayMs: 400 },
			{ text: 'git commit -m "feat: add authentication screens"', delayMs: 300 },
			{ text: '\x1b[32m✓\x1b[0m Authentication screens complete', delayMs: 200 },
		]
	}
};

/**
 * Get mock session for a given issue id, or null if no session exists.
 * @param {string} issueId
 * @returns {MockTerminalSession | null}
 */
export function getMockSession(issueId) {
	return mockSessions[issueId] ?? null;
}

/**
 * Stream terminal output to an xterm Terminal instance with realistic timing.
 * Returns a cancel function — call it to stop streaming.
 *
 * @param {import('@xterm/xterm').Terminal} term
 * @param {OutputLine[]} lines
 * @param {() => void} [onDone]
 * @returns {() => void} cancel
 */
export function streamOutput(term, lines, onDone) {
	let cancelled = false;
	let timeoutId = /** @type {ReturnType<typeof setTimeout> | null} */ (null);

	async function run() {
		for (const line of lines) {
			if (cancelled) return;
			if (line.delayMs > 0) {
				await new Promise((resolve) => {
					timeoutId = setTimeout(resolve, line.delayMs);
				});
			}
			if (cancelled) return;
			term.writeln(line.text);
		}
		if (!cancelled) onDone?.();
	}

	run();

	return () => {
		cancelled = true;
		if (timeoutId !== null) clearTimeout(timeoutId);
	};
}
