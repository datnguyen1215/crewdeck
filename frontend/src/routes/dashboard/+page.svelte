<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { listProjectsWithStats, listGlobalActivity, getActiveAgents, listVCSAccounts, getAuthMe, listActiveRunsGlobal, listCaptainStatuses, getGlobalMonitorHistory, type ProjectWithStats, type ActivityLog, type VCSAccount, type GlobalActiveRun, type GlobalCaptainStatus } from '$lib/api/http.js';
	import { fetchEffect } from '$lib/utils/fetch-effect.svelte.js';
	import { globalWs } from '$lib/api/global-ws.svelte.js';
	import { autoscroll } from '$lib/utils/autoscroll.js';
	import { md } from '$lib/utils/markdown.js';
	import { mapMessageToEntry } from '$lib/utils/monitor.js';
	import type { MonitorEntry } from '$lib/api/types.js';
	import DashboardActivityFeed from '$lib/components/DashboardActivityFeed.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import ProjectForm from '$lib/components/ProjectForm.svelte';

	let projects = $state<ProjectWithStats[]>([]);
	let loading = $state(true);
	let activity = $state<ActivityLog[]>([]);
	let activityLoading = $state(true);
	let activeAgents = $state(0);
	let maxConcurrency = $state(5);
	let showCreateModal = $state(false);
	let githubAccounts = $state<VCSAccount[]>([]);
	let captains = $state<GlobalCaptainStatus[]>([]);
	let captainsCollapsed = $state(false);
	let captainsInitialized = $state(false);

	// Per-project monitor feeds: project_id -> MonitorEntry[]
	let monitorFeeds = $state<Record<string, MonitorEntry[]>>({});
	// Per-project analyzing state: project_id -> boolean
	let analyzingState = $state<Record<string, boolean>>({});

	// Active agent runs state
	let runs = $state<GlobalActiveRun[]>([]);
	let runsLoading = $state(true);
	let agentPaneCollapsed = $state(
		typeof localStorage !== 'undefined'
			? localStorage.getItem('dashboard:agentPaneCollapsed') === 'true'
			: false
	);

	// Elapsed time ticker
	let elapsedTick = $state(0);
	$effect(() => {
		if (runs.length === 0) return;
		const interval = setInterval(() => { elapsedTick++; }, 1000);
		return () => clearInterval(interval);
	});

	function toggleAgentPane() {
		agentPaneCollapsed = !agentPaneCollapsed;
		localStorage.setItem('dashboard:agentPaneCollapsed', String(agentPaneCollapsed));
	}

	async function refreshRuns() {
		try {
			runs = await listActiveRunsGlobal(true);
		} catch {}
	}

	async function refreshProjects() {
		try { projects = await listProjectsWithStats(); } catch {}
	}

	async function refreshActiveAgents() {
		try {
			const data = await getActiveAgents();
			activeAgents = data.activeAgents;
			maxConcurrency = data.maxConcurrency;
		} catch {}
	}

	async function refreshActivity() {
		const isInitialLoad = activity.length === 0;
		if (isInitialLoad) activityLoading = true;
		try {
			activity = await listGlobalActivity({ limit: 10 });
		} catch {}
		if (isInitialLoad) activityLoading = false;
	}

	async function refreshCaptains() {
		try { captains = await listCaptainStatuses(); } catch {}
	}

	fetchEffect(() => listProjectsWithStats(), {
		onData: (data) => { projects = data; },
		onError: 'Failed to load dashboard',
		onLoading: (v) => { loading = v; },
	});

	fetchEffect(() => getActiveAgents(), {
		onData: (data) => { activeAgents = data.activeAgents; maxConcurrency = data.maxConcurrency; },
		onError: 'Failed to load active agents',
		onLoading: () => {},
	});

	fetchEffect(() => listActiveRunsGlobal(true), {
		onData: (data) => { runs = data; },
		onError: 'Failed to load active runs',
		onLoading: (v) => { runsLoading = v; },
	});

	refreshActivity();
	refreshCaptains();

	async function loadGlobalMonitorHistory() {
		try {
			const history = await getGlobalMonitorHistory(50);
			// Group by project_id
			const feeds: Record<string, MonitorEntry[]> = {};
			for (const msg of history) {
				if (!feeds[msg.project_id]) feeds[msg.project_id] = [];
				feeds[msg.project_id].push(mapMessageToEntry(msg));
			}
			monitorFeeds = feeds;
		} catch {}
	}

	loadGlobalMonitorHistory();

	const STATS_EVENTS = ['run.started', 'run.completed', 'issue.status_changed', 'issue.paused', 'issue.resumed', 'issue.created', 'dispatch.queued', 'dispatch.dequeued'] as const;
	const ACTIVITY_EVENTS = [
		'issue.created', 'issue.status_changed', 'issue.paused', 'issue.resumed',
		'comment.added', 'pr.created', 'mention.spawned', 'mention.completed',
		'mention.error', 'dispatch.queued', 'run.started', 'run.completed',
	] as const;
	const AGENT_EVENTS = ['run.started', 'run.completed', 'dispatch.queued', 'dispatch.dequeued'] as const;
	const CAPTAIN_EVENTS = ['run.started', 'run.completed', 'dispatch.queued', 'dispatch.dequeued'] as const;
	let unsubs: (() => void)[] = [];

	function appendMonitorEntry(projectId: string, entry: MonitorEntry) {
		const prev = monitorFeeds[projectId] ?? [];
		monitorFeeds = { ...monitorFeeds, [projectId]: [...prev.slice(-49), entry] };
	}

	onMount(async () => {
		unsubs = [
			...STATS_EVENTS.map((e) => globalWs.on(e, refreshProjects)),
			...ACTIVITY_EVENTS.map((e) => globalWs.on(e, refreshActivity)),
			...AGENT_EVENTS.map((e) => globalWs.on(e, refreshActiveAgents)),
			...CAPTAIN_EVENTS.map((e) => globalWs.on(e, refreshCaptains)),

			// Active runs pane: refresh list on lifecycle events
			globalWs.on('run.started', refreshRuns),
			globalWs.on('dispatch.dequeued', refreshRuns),
			globalWs.on('mention.spawned', refreshRuns),

			// Live event feed: append event to matching run card
			globalWs.on('run.event', (data) => {
				const event = {
					id: data.event_id,
					agent_run_id: data.agent_run_id,
					type: data.type,
					data: data.data,
					created_at: data.created_at,
				};
				runs = runs.map((r) => {
					if (r.id !== data.agent_run_id) return r;
					return { ...r, events: [...r.events.slice(-49), event] };
				});
			}),

			// Remove completed runs
			globalWs.on('run.completed', (data) => {
				runs = runs.filter((r) => r.id !== data.agent_run_id);
			}),
			globalWs.on('mention.completed', refreshRuns),

			// Global monitor feed events
			globalWs.on('monitor.event_received', (data) => {
				appendMonitorEntry(data.project_id, {
					id: crypto.randomUUID(),
					type: 'event',
					content: `${data.event_type} - ${data.description ?? ''}`,
					timestamp: new Date(),
				});
			}),
			globalWs.on('monitor.thinking', (data) => {
				analyzingState = { ...analyzingState, [data.project_id]: true };
				appendMonitorEntry(data.project_id, {
					id: crypto.randomUUID(),
					type: 'thinking',
					content: data.content ?? 'Analyzing...',
					timestamp: new Date(),
				});
			}),
			globalWs.on('monitor.message', (data) => {
				appendMonitorEntry(data.project_id, {
					id: crypto.randomUUID(),
					type: 'message',
					content: data.content,
					timestamp: new Date(),
				});
			}),
			globalWs.on('monitor.tool_call', (data) => {
				appendMonitorEntry(data.project_id, {
					id: crypto.randomUUID(),
					type: 'tool_call',
					content: data.tool_name,
					toolName: data.tool_name,
					toolInput: data.tool_input,
					timestamp: new Date(),
				});
			}),
			globalWs.on('monitor.tool_result', (data) => {
				const result = data.result as { success: boolean; message: string } | undefined;
				appendMonitorEntry(data.project_id, {
					id: crypto.randomUUID(),
					type: 'tool_result',
					content: result?.message ?? '',
					toolName: data.tool_name,
					success: result?.success ?? true,
					timestamp: new Date(),
				});
			}),
			globalWs.on('monitor.rate_limit', (data) => {
				appendMonitorEntry(data.project_id, {
					id: crypto.randomUUID(),
					type: 'rate_limit',
					content: data.message,
					timestamp: new Date(),
				});
			}),
			globalWs.on('monitor.result', (data) => {
				const parts: string[] = [];
				if (data.stop_reason) parts.push(data.stop_reason);
				if (data.cost_usd != null) parts.push(`$${data.cost_usd.toFixed(2)}`);
				if (data.duration_ms != null) {
					const secs = Math.floor(data.duration_ms / 1000);
					parts.push(secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`);
				}
				appendMonitorEntry(data.project_id, {
					id: crypto.randomUUID(),
					type: 'result',
					content: parts.length > 0 ? parts.join(' · ') : 'Done',
					costUsd: data.cost_usd,
					durationMs: data.duration_ms,
					timestamp: new Date(),
				});
			}),
			globalWs.on('monitor.complete', (data) => {
				analyzingState = { ...analyzingState, [data.project_id]: false };
				const prev = monitorFeeds[data.project_id] ?? [];
				monitorFeeds = { ...monitorFeeds, [data.project_id]: prev.filter(e => e.type !== 'thinking') };
			}),
		];

		// Load captains collapse state from localStorage
		const stored = localStorage.getItem('crewdeck:dashboard:captains-collapsed');
		if (stored !== null) captainsCollapsed = stored === 'true';
		captainsInitialized = true;

		try {
			const { setupCompleted } = await getAuthMe();
			if (!setupCompleted) {
				goto('/setup/preflight');
				return;
			}
		} catch {}
	});

	onDestroy(() => {
		unsubs.forEach((fn) => fn());
	});

	const TABLE_COLS = [
		{ key: 'open', label: 'OPEN', color: 'text-blue' },
		{ key: 'in_progress', label: 'PROG', color: 'text-amber' },
		{ key: 'pr_created', label: 'PR', color: 'text-purple' },
		{ key: 'blocked', label: 'BLK', color: 'text-red' },
		{ key: 'pr_ready_to_merge', label: 'RDY', color: 'text-green' },
		{ key: 'done', label: 'DONE', color: 'text-secondary' },
	] as const;

	let summary = $derived.by(() => {
		if (projects.length === 0) return '';
		let inProgress = 0, done = 0;
		for (const p of projects) {
			inProgress += p.issues.in_progress;
			done += p.issues.done;
		}
		return `${projects.length} project${projects.length !== 1 ? 's' : ''} │ ${activeAgents}/${maxConcurrency} agents │ ${inProgress} in progress │ ${done} done`;
	});

	let runsSummary = $derived.by(() => {
		const running = runs.filter((r) => r.status === 'running').length;
		const queued = runs.filter((r) => r.status === 'queued').length;
		const parts: string[] = [];
		if (running > 0) parts.push(`${running} running`);
		if (queued > 0) parts.push(`${queued} queued`);
		return parts.join(' · ') || 'none';
	});

	let captainsSummary = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const c of captains) {
			counts[c.status] = (counts[c.status] ?? 0) + 1;
		}
		return Object.entries(counts)
			.filter(([, n]) => n > 0)
			.map(([s, n]) => `${n} ${s}`)
			.join(' · ') || 'all idle';
	});

	function toggleCaptains() {
		captainsCollapsed = !captainsCollapsed;
		if (captainsInitialized) {
			localStorage.setItem('crewdeck:dashboard:captains-collapsed', String(captainsCollapsed));
		}
	}


	function blockedCount(issues: ProjectWithStats['issues']) {
		return issues.pr_conflict + issues.pr_failed_actions;
	}

	function statusValue(p: ProjectWithStats, key: string): number {
		if (key === 'blocked') return blockedCount(p.issues);
		return p.issues[key as keyof typeof p.issues] ?? 0;
	}

	function shortId(id: string): string {
		return id.slice(0, 8);
	}

	async function openCreateModal() {
		showCreateModal = true;
		try { githubAccounts = await listVCSAccounts(); } catch {}
	}

	// Agent card formatting
	interface FormattedEvent {
		label: string;
		content: string | null;
	}

	function formatToolUse(tool: { name: string; input: unknown }): FormattedEvent {
		const input = tool.input as Record<string, unknown> | undefined;
		switch (tool.name) {
			case 'Read': return { label: 'Read', content: (input?.file_path as string) ?? null };
			case 'Edit': return { label: 'Edit', content: (input?.file_path as string) ?? null };
			case 'Write': return { label: 'Write', content: (input?.file_path as string) ?? null };
			case 'Bash': return { label: 'Bash', content: (input?.command as string) ?? (input?.description as string) ?? null };
			case 'Glob': return { label: 'Glob', content: (input?.pattern as string) ?? null };
			case 'Grep': return { label: 'Grep', content: (input?.pattern as string) ?? null };
			case 'Task': return { label: 'Task', content: (input?.description as string) ?? (input?.prompt as string) ?? null };
			case 'TodoWrite': return { label: 'TodoWrite', content: null };
			default: return { label: tool.name || 'Tool', content: input ? JSON.stringify(input).slice(0, 200) : null };
		}
	}

	function formatEvent(event: { type: string; data: unknown }): FormattedEvent {
		const d = event.data as Record<string, unknown> | null;
		switch (event.type) {
			case 'assistant': {
				if (d?.text) return { label: 'Assistant', content: d.text as string };
				if (Array.isArray(d?.tool_use) && d.tool_use.length > 0) {
					return formatToolUse(d.tool_use[0] as { name: string; input: unknown });
				}
				return { label: 'Assistant', content: null };
			}
			case 'user': {
				if (Array.isArray(d?.tool_results) && d.tool_results.length > 0) {
					const result = d.tool_results[0] as { output: string };
					return { label: 'Result', content: result.output || null };
				}
				return { label: 'User', content: null };
			}
			case 'tool_use': {
				if (Array.isArray(d?.tool_use) && d.tool_use.length > 0) {
					return formatToolUse(d.tool_use[0] as { name: string; input: unknown });
				}
				return { label: 'Tool', content: null };
			}
			case 'tool_result': {
				if (Array.isArray(d?.tool_results) && d.tool_results.length > 0) {
					const result = d.tool_results[0] as { output: string };
					return { label: 'Result', content: result.output || null };
				}
				return { label: 'Result', content: null };
			}
			case 'system': {
				if (d?.model) return { label: 'System', content: `Session started (${d.model})` };
				if (d?.subtype) return { label: 'System', content: d.subtype as string };
				if (d?.message) return { label: 'System', content: d.message as string };
				return { label: 'System', content: null };
			}
			case 'result': return { label: 'Finished', content: (d?.result as string) ?? null };
			case 'error': return { label: 'Error', content: (d?.error as string) ?? 'unknown' };
			default: return { label: event.type, content: d ? JSON.stringify(d).slice(0, 200) : null };
		}
	}

	function formatElapsed(startedAt: string | null): string {
		if (!startedAt) return '0s';
		const ms = Date.now() - new Date(startedAt).getTime();
		const secs = Math.floor(ms / 1000);
		if (secs < 60) return `${secs}s`;
		const mins = Math.floor(secs / 60);
		const remainSecs = secs % 60;
		if (mins < 60) return `${mins}m ${remainSecs}s`;
		const hrs = Math.floor(mins / 60);
		return `${hrs}h ${mins % 60}m`;
	}

	function formatCost(cost: number | null): string {
		if (cost === null || cost === undefined) return '$0.00';
		return `$${cost.toFixed(2)}`;
	}

	function statusColor(status: string): string {
		switch (status) {
			case 'running': return 'text-green bg-green/10 border-green/30';
			case 'queued': return 'text-amber bg-amber/10 border-amber/30';
			default: return 'text-muted bg-surface border-edge';
		}
	}

	function formatMonitorTime(date: Date): string {
		return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}

	function formatToolInput(input: unknown): string {
		if (!input) return '';
		if (typeof input === 'object') {
			return Object.entries(input as Record<string, unknown>)
				.map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
				.join(', ');
		}
		return String(input);
	}

	function monitorTypeLabel(type: MonitorEntry['type']): string {
		switch (type) {
			case 'event': return 'event';
			case 'thinking': return 'monitor';
			case 'message': return 'monitor';
			case 'tool_call': return 'tool';
			case 'tool_result': return 'tool';
			case 'rate_limit': return 'limit';
			case 'result': return 'done';
		}
	}

	function monitorTypeColor(type: MonitorEntry['type']): string {
		switch (type) {
			case 'event': return 'text-yellow/80';
			case 'thinking': return 'text-cyan';
			case 'message': return 'text-cyan';
			case 'tool_call': return 'text-purple';
			case 'tool_result': return 'text-purple';
			case 'rate_limit': return 'text-amber';
			case 'result': return 'text-green';
		}
	}
</script>

<svelte:head>
	<title>Dashboard - CrewDeck</title>
</svelte:head>

<div class="p-4 md:p-8 h-full overflow-auto pt-14 md:pt-8 terminal-scanlines">
	<!-- Header -->
	<div class="mb-8 md:mb-10 fade-up">
		<p class="text-muted text-sm uppercase tracking-widest mb-2">Cross-project Overview</p>
		<h1 class="text-xl md:text-2xl font-bold text-primary font-mono">Crew Status</h1>
	</div>

	{#if loading}
		<!-- Skeleton: terminal-style -->
		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<div class="lg:col-span-2">
				<div class="bg-surface border border-edge rounded-sm">
					<!-- Pane header skeleton -->
					<div class="flex items-center gap-2 px-4 py-2 bg-base-hi rounded-t-sm">
						<div class="skeleton h-4 w-28 rounded"></div>
					</div>
					<div class="p-4 space-y-2">
						{#each Array(4) as _}
							<div class="skeleton h-4 w-full rounded"></div>
						{/each}
					</div>
				</div>
			</div>
			<div>
				<div class="bg-surface border border-edge rounded-sm">
					<div class="flex items-center gap-2 px-3 py-1.5 bg-base-hi rounded-t-sm">
						<span class="skeleton h-3.5 w-20 rounded ml-auto"></span>
					</div>
					<div class="p-4 space-y-2">
						{#each Array(5) as _}
							<div class="skeleton h-3.5 w-full rounded"></div>
						{/each}
					</div>
				</div>
			</div>
		</div>
	{:else if projects.length === 0}
		<!-- Empty state -->
		<div class="bg-surface border border-edge rounded-sm">
			<div class="flex items-center gap-2 px-3 py-1.5 bg-base-hi rounded-t-sm">
				<span class="text-muted text-sm font-mono">crew status</span>
			</div>
			<div class="p-6 text-center">
				<p class="text-primary text-sm font-mono mb-1">No projects yet</p>
				<p class="text-muted text-sm font-mono mb-4">Create a project to see dashboard output</p>
				<button
					onclick={openCreateModal}
					class="px-4 py-2 text-sm font-mono bg-cyan/10 border border-cyan text-cyan rounded-sm hover:bg-cyan/20 transition-colors"
				>+ Create Project</button>
			</div>
		</div>
	{:else}
		<!-- Two-column layout: process list + activity log -->
		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<!-- Left: Process list -->
			<div class="lg:col-span-2 space-y-6">
				<div class="bg-surface border border-edge rounded-sm fade-up">
					<!-- Pane header -->
					<div class="flex items-center px-4 py-2 bg-base-hi rounded-t-sm">
						<span class="text-muted text-sm font-mono">crew status</span>
						<button
							onclick={openCreateModal}
							class="ml-auto px-2.5 py-1 text-xs font-mono bg-cyan/10 border border-cyan text-cyan rounded-sm hover:bg-cyan/20 transition-colors"
						>+ New Project</button>
					</div>

					<!-- Table header -->
					<div class="hidden md:flex gap-2 text-sm uppercase tracking-wider px-4 py-2 border-b border-edge font-mono">
						<span class="w-16 flex-shrink-0 text-muted">ID</span>
						<span class="flex-1 min-w-0 text-muted">PROJECT</span>
						{#each TABLE_COLS as col}
							<span class="w-12 text-center flex-shrink-0 {col.color}">{col.label}</span>
						{/each}
						<span class="w-14 text-center flex-shrink-0 text-cyan">AGENTS</span>
						<span class="w-14 text-center flex-shrink-0 text-muted">STATUS</span>
					</div>

					<!-- Table rows -->
					<div class="overflow-x-auto">
						{#each projects as project, i (project.id)}
							{@const isActive = project.active_runs > 0}
							<!-- Mobile card view -->
							<a
								href="/projects/{project.id}"
								class="block md:hidden px-4 py-2.5 border-b border-edge last:border-0 hover:bg-base-hi transition-colors {isActive ? 'bg-cyan/5' : ''}"
								style="animation: fade-up 0.25s ease both; animation-delay: {i * 40}ms"
							>
								<div class="flex items-center justify-between mb-1">
									<span class="text-primary text-sm font-mono truncate mr-2">{project.name}</span>
									<span class="text-sm font-mono {isActive ? 'text-cyan' : 'text-muted'}">{isActive ? 'active' : 'idle'}</span>
								</div>
								<div class="flex gap-3 text-sm font-mono text-muted">
									<span class="text-secondary/60 text-xs">{shortId(project.id)}</span>
									{#each TABLE_COLS as col}
										{@const count = statusValue(project, col.key)}
										<span class={count > 0 ? 'text-primary' : ''}>{count}</span>
									{/each}
								</div>
							</a>

							<!-- Desktop row -->
							<div
								class="hidden md:flex items-center gap-2 px-4 py-2 border-b border-edge last:border-0 hover:bg-base-hi transition-colors cursor-pointer group {isActive ? 'bg-cyan/5' : ''}"
								role="link"
								tabindex="0"
								onclick={() => goto(`/projects/${project.id}`)}
								onkeydown={(e) => e.key === 'Enter' && goto(`/projects/${project.id}`)}
								style="animation: fade-up 0.25s ease both; animation-delay: {i * 40}ms"
							>
								<span class="w-16 text-sm font-mono text-secondary/60 flex-shrink-0">{shortId(project.id)}</span>
								<span class="flex-1 text-sm font-mono text-primary truncate group-hover:text-cyan transition-colors">{project.name}</span>
								{#each TABLE_COLS as col}
									{@const count = statusValue(project, col.key)}
									<span class="w-12 text-center text-sm font-mono flex-shrink-0 {col.key === 'blocked' && count > 0 ? 'text-red' : count > 0 ? 'text-primary' : 'text-muted'}">{count}</span>
								{/each}
								<span class="w-14 text-center text-sm font-mono flex-shrink-0 {isActive ? 'text-cyan' : 'text-muted'}">{project.active_runs}</span>
								<span class="w-14 text-center text-sm font-mono flex-shrink-0 {isActive ? 'text-cyan' : 'text-muted'}">{isActive ? 'active' : 'idle'}</span>
							</div>
						{/each}
					</div>

					<!-- Summary line -->
					{#if summary}
						<div class="px-4 py-2 border-t border-edge text-sm font-mono text-muted">
							{summary}
						</div>
					{/if}
				</div>

				<!-- Active Agents Pane -->
				<div class="bg-surface border border-edge rounded-sm fade-up">
					<!-- Pane header with collapse toggle -->
					<button
						onclick={toggleAgentPane}
						class="w-full flex items-center gap-2 px-4 py-2 bg-base-hi rounded-t-sm hover:bg-base-hi/80 transition-colors text-left"
					>
						<span class="text-muted text-sm font-mono">
							active agents ({runs.length})
						</span>
						{#if agentPaneCollapsed}
							<span class="text-xs font-mono text-muted/60 ml-1">{runsSummary}</span>
						{/if}
						<span class="ml-auto text-muted text-xs font-mono select-none">
							{agentPaneCollapsed ? '▸' : '▾'}
						</span>
					</button>

					{#if !agentPaneCollapsed}
						{#if runsLoading}
							<div class="p-4 space-y-2">
								{#each Array(2) as _}
									<div class="skeleton h-4 w-full rounded"></div>
								{/each}
							</div>
						{:else if runs.length === 0}
							<div class="px-4 py-6 text-center">
								<p class="text-muted text-sm font-mono">No active agents</p>
							</div>
						{:else}
							<div class="p-4 grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));">
								{#each runs as run (run.id)}
									{@const isRunning = run.status === 'running'}
									<div class="bg-base border border-edge rounded-lg overflow-hidden flex flex-col">
										<!-- Card header -->
										<div class="px-4 py-3 border-b border-edge bg-base-hi">
											<div class="flex items-center gap-2 mb-1">
												<span class="text-sm font-medium text-primary">{run.agent_name}</span>
												{#if run.project_name}
													<span class="text-xs text-muted/60 font-mono">· {run.project_name}</span>
												{/if}
												<span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border {statusColor(run.status)}">
													{run.status}
												</span>
												{#if isRunning}
													<span class="w-1.5 h-1.5 rounded-full bg-green animate-pulse"></span>
												{/if}
											</div>
											{#if run.issue_title}
												<a
													href="/projects/{run.project_id}/issues/{run.issue_id}"
													class="text-xs text-muted hover:text-cyan transition-colors truncate block"
													title={run.issue_title}
												>
													{run.issue_title}
												</a>
											{/if}
										</div>

										<!-- Live event feed -->
										<div
											class="flex-1 min-h-[180px] max-h-[280px] overflow-y-auto p-3 font-mono text-xs space-y-2 bg-black/20"
											use:autoscroll
										>
											{#if run.events.length === 0}
												<div class="text-muted italic py-6 text-center">
													{run.status === 'queued' ? 'Waiting in queue...' : 'Waiting for events...'}
												</div>
											{:else}
												{#each run.events.slice(-30) as event (event.id)}
													{@const formatted = formatEvent(event)}
													<div class="py-1 border-b border-edge/30 last:border-0">
														<div class="flex gap-2 text-secondary">
															<span class="text-muted flex-shrink-0 select-none">{new Date(event.created_at).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
															<span class="text-cyan font-medium">{formatted.label}</span>
														</div>
														{#if formatted.content}
															<pre class="mt-1 ml-[72px] text-secondary whitespace-pre-wrap break-words max-h-24 overflow-y-auto">{formatted.content}</pre>
														{/if}
													</div>
												{/each}
											{/if}
										</div>

										<!-- Footer -->
										<div class="px-4 py-2 border-t border-edge flex items-center justify-between text-xs text-muted bg-base-hi">
											<span>{#key elapsedTick}{formatElapsed(run.started_at)}{/key}</span>
											<span>{formatCost(run.cost_usd)}</span>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					{/if}
				</div>
			</div>

			<!-- Right: Activity log -->
			<div class="lg:sticky lg:top-8 lg:self-start lg:max-h-[calc(100vh-4rem)]">
				<DashboardActivityFeed entries={activity} loading={activityLoading} />
			</div>
		</div>

		<!-- Captains pane -->
		<div class="mt-6 bg-surface border border-edge rounded-sm fade-up">
			<!-- Header -->
			<button
				onclick={toggleCaptains}
				class="w-full flex items-center gap-2 px-4 py-2 bg-base-hi rounded-t-sm hover:bg-base-hi/80 transition-colors"
			>
				<span class="text-muted text-sm font-mono">captains ({captains.length})</span>
				{#if captainsCollapsed}
					<span class="text-secondary text-xs font-mono ml-2">{captainsSummary}</span>
				{/if}
				<span class="ml-auto text-muted text-xs">{captainsCollapsed ? '▶' : '▼'}</span>
			</button>

			{#if !captainsCollapsed}
				{#if captains.length === 0}
					<div class="px-4 py-4 text-muted text-sm font-mono">No captains</div>
				{:else}
					<div class="p-4 grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));">
						{#each captains as captain (captain.project_id)}
							{@const isAnalyzing = analyzingState[captain.project_id] ?? false}
							{@const entries = monitorFeeds[captain.project_id] ?? []}
							<div class="bg-surface border border-cyan/30 rounded-lg overflow-hidden flex flex-col">
								<div class="px-4 py-3 border-b border-cyan/30 bg-cyan/5">
									<div class="flex items-center gap-2 mb-1">
										<a href="/projects/{captain.project_id}/issues" class="text-sm font-medium text-cyan hover:underline">
											{captain.project_name}
										</a>
										<span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border {isAnalyzing ? 'text-cyan bg-cyan/10 border-cyan/30' : 'text-muted bg-surface border-edge'}">
											{isAnalyzing ? 'Analyzing' : 'Monitoring'}
										</span>
										{#if isAnalyzing}
											<span class="w-1.5 h-1.5 rounded-full bg-cyan animate-pulse"></span>
										{/if}
									</div>
									<p class="text-xs text-muted">Project orchestration feed</p>
								</div>

								<div
									use:autoscroll
									class="flex-1 min-h-[200px] max-h-[300px] overflow-y-auto p-3 font-mono text-xs bg-black/20"
								>
									{#if entries.length === 0}
										<div class="text-muted py-8 text-center">
											<p class="mb-2">Monitor feed empty.</p>
											<p class="text-xs">Orchestration events will appear here.</p>
										</div>
									{:else}
										<div class="space-y-2">
											{#each entries.slice(-50) as entry (entry.id)}
												<div class="flex gap-2 min-w-0">
													<span class="text-muted/50 flex-shrink-0">[{formatMonitorTime(entry.timestamp)}]</span>
													<span class="{monitorTypeColor(entry.type)} flex-shrink-0">[{monitorTypeLabel(entry.type)}]</span>
													{#if entry.type === 'event'}
														<span class="text-muted break-words min-w-0">{entry.content}</span>
													{:else if entry.type === 'thinking'}
														<span class="text-muted animate-pulse min-w-0">{entry.content}</span>
													{:else if entry.type === 'message'}
														<span class="text-primary prose prose-sm prose-invert max-w-none inline break-words min-w-0">
															{@html md(entry.content)}
														</span>
													{:else if entry.type === 'tool_call'}
														<span class="text-purple break-words min-w-0">
															<span class="text-muted/50">-></span> {entry.toolName}({formatToolInput(entry.toolInput)})
														</span>
													{:else if entry.type === 'tool_result'}
														<span class="text-muted/50 flex-shrink-0">-></span>
														<span class="{entry.success ? 'text-green' : 'text-red'} min-w-0">
															{entry.success ? 'ok' : 'err'}:
														</span>
														<span class="text-muted break-words min-w-0">{entry.content}</span>
													{:else if entry.type === 'rate_limit'}
														<span class="text-amber break-words min-w-0">⏳ {entry.content}</span>
													{:else if entry.type === 'result'}
														<span class="text-green break-words min-w-0">✓ {entry.content}</span>
													{/if}
												</div>
											{/each}
										</div>
									{/if}
								</div>

								<div class="px-4 py-2 border-t border-cyan/30 text-xs text-muted bg-cyan/5">
									<span class="font-mono">Read-only feed</span>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<Modal open={showCreateModal} onClose={() => showCreateModal = false} label="Create Project" maxWidth="max-w-md">
	<h2 class="text-sm font-mono text-muted uppercase tracking-widest mb-4">Create Project</h2>
	<ProjectForm
		{githubAccounts}
		onCreated={() => { showCreateModal = false; refreshProjects(); }}
		onCancel={() => showCreateModal = false}
	/>
</Modal>
