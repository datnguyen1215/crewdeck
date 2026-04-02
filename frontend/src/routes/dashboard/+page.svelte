<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { listProjectsWithStats, listGlobalActivity, getActiveAgents, type ProjectWithStats, type ActivityLog } from '$lib/api/http.js';
	import { fetchEffect } from '$lib/utils/fetch-effect.svelte.js';
	import { GlobalWebSocket } from '$lib/api/global-ws.svelte.js';
	import DashboardActivityFeed from '$lib/components/DashboardActivityFeed.svelte';

	let projects = $state<ProjectWithStats[]>([]);
	let loading = $state(true);
	let activity = $state<ActivityLog[]>([]);
	let activityLoading = $state(true);
	let activeAgents = $state(0);
	let maxConcurrency = $state(5);

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

	refreshActivity();

	const globws = new GlobalWebSocket();
	globws.connect();

	const STATS_EVENTS = ['run.started', 'run.completed', 'issue.status_changed', 'issue.paused', 'issue.resumed'] as const;
	const ACTIVITY_EVENTS = [
		'issue.created', 'issue.status_changed', 'issue.paused', 'issue.resumed',
		'comment.added', 'pr.created', 'mention.spawned', 'mention.completed',
		'mention.error', 'dispatch.queued', 'run.started', 'run.completed',
	] as const;
	const AGENT_EVENTS = ['run.started', 'run.completed'] as const;
	const unsubs = [
		...STATS_EVENTS.map((e) => globws.on(e, refreshProjects)),
		...ACTIVITY_EVENTS.map((e) => globws.on(e, refreshActivity)),
		...AGENT_EVENTS.map((e) => globws.on(e, refreshActiveAgents)),
	];

	onDestroy(() => {
		globws.disconnect();
		unsubs.forEach((fn) => fn());
	});

	const TABLE_COLS = [
		{ key: 'open', label: 'OPEN' },
		{ key: 'in_progress', label: 'PROG' },
		{ key: 'pr_created', label: 'PR' },
		{ key: 'blocked', label: 'BLK' },
		{ key: 'pr_ready_to_merge', label: 'RDY' },
		{ key: 'done', label: 'DONE' },
	] as const;

	let summary = $derived.by(() => {
		if (projects.length === 0) return '';
		const totals = { open: 0, in_progress: 0, pr_created: 0, blocked: 0, pr_ready_to_merge: 0, done: 0, agents: 0 };
		for (const p of projects) {
			totals.open += p.issues.open;
			totals.in_progress += p.issues.in_progress;
			totals.pr_created += p.issues.pr_created;
			totals.blocked += p.issues.pr_conflict + p.issues.pr_failed_actions;
			totals.pr_ready_to_merge += p.issues.pr_ready_to_merge;
			totals.done += p.issues.done;
			totals.agents += p.active_runs;
		}
		return `${projects.length} project${projects.length !== 1 ? 's' : ''} │ ${activeAgents}/${maxConcurrency} agents │ ${totals.in_progress} in progress │ ${totals.done} done`;
	});

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
</script>

<svelte:head>
	<title>Dashboard - CrewDeck</title>
</svelte:head>

{#if globws.state === 'reconnecting' || globws.state === 'connecting'}
	<div class="fixed top-0 left-0 right-0 z-[300] flex items-center justify-center gap-2 py-1 bg-amber/10 border-b border-amber/30 text-amber text-xs" style="view-transition-name: none">
		<span class="inline-block w-1.5 h-1.5 rounded-full bg-amber animate-pulse"></span>
		{globws.state === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
	</div>
{/if}

<div class="p-4 md:p-8 h-full overflow-auto pt-14 md:pt-8 terminal-scanlines">
	<!-- Header -->
	<div class="mb-6 md:mb-8 fade-up">
		<p class="text-muted text-xs uppercase tracking-widest mb-1">Cross-project Overview</p>
		<h1 class="text-lg md:text-xl font-bold text-primary font-mono">
			<span class="text-cyan">$</span> crew status --all
		</h1>
	</div>

	{#if loading}
		<!-- Skeleton: terminal-style -->
		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<div class="lg:col-span-2">
				<div class="bg-surface border border-edge rounded-sm">
					<!-- Terminal chrome skeleton -->
					<div class="flex items-center gap-2 px-4 py-2.5 border-b border-edge bg-base-hi">
						<div class="flex gap-1.5">
							<div class="skeleton w-2.5 h-2.5 rounded-full"></div>
							<div class="skeleton w-2.5 h-2.5 rounded-full"></div>
							<div class="skeleton w-2.5 h-2.5 rounded-full"></div>
						</div>
						<div class="skeleton h-3 w-32 rounded"></div>
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
					<div class="flex items-center gap-2 px-4 py-2.5 border-b border-edge bg-base-hi">
						<div class="flex gap-1.5">
							<div class="skeleton w-2.5 h-2.5 rounded-full"></div>
							<div class="skeleton w-2.5 h-2.5 rounded-full"></div>
							<div class="skeleton w-2.5 h-2.5 rounded-full"></div>
						</div>
						<div class="skeleton h-3 w-24 rounded"></div>
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
			<div class="flex items-center gap-2 px-4 py-2.5 border-b border-edge bg-base-hi">
				<div class="flex gap-1.5">
					<span class="w-2.5 h-2.5 rounded-full bg-red/70"></span>
					<span class="w-2.5 h-2.5 rounded-full bg-amber/70"></span>
					<span class="w-2.5 h-2.5 rounded-full bg-green/70"></span>
				</div>
				<span class="text-muted text-xs">bash — crew</span>
			</div>
			<div class="p-6 text-center">
				<p class="text-primary text-sm font-mono mb-1">No projects yet</p>
				<p class="text-muted text-xs font-mono">Create a project to see dashboard output</p>
			</div>
		</div>
	{:else}
		<!-- Two-column layout: process list + activity log -->
		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<!-- Left: Process list -->
			<div class="lg:col-span-2">
				<div class="bg-surface border border-edge rounded-sm fade-up">
					<!-- Terminal chrome -->
					<div class="flex items-center gap-2 px-4 py-2.5 border-b border-edge bg-base-hi rounded-t-sm">
						<div class="flex gap-1.5">
							<span class="w-2.5 h-2.5 rounded-full bg-red/70"></span>
							<span class="w-2.5 h-2.5 rounded-full bg-amber/70"></span>
							<span class="w-2.5 h-2.5 rounded-full bg-green/70"></span>
						</div>
						<span class="text-muted text-xs font-mono">bash — crew status</span>
					</div>

					<!-- Table header -->
					<div class="hidden md:flex text-xs text-muted uppercase tracking-wider px-4 py-2 border-b border-edge font-mono">
						<span class="w-16 flex-shrink-0">ID</span>
						<span class="flex-1 min-w-0">PROJECT</span>
						{#each TABLE_COLS as col}
							<span class="w-10 text-center flex-shrink-0">{col.label}</span>
						{/each}
						<span class="w-10 text-center flex-shrink-0">AGENTS</span>
						<span class="w-14 text-center flex-shrink-0">STATUS</span>
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
									<span class="text-primary text-xs font-mono truncate mr-2">{project.name}</span>
									<span class="text-xs font-mono {isActive ? 'text-cyan' : 'text-muted'}">{isActive ? 'active' : 'idle'}</span>
								</div>
								<div class="flex gap-3 text-xs font-mono text-muted">
									<span class="text-secondary/60">{shortId(project.id)}</span>
									{#each TABLE_COLS as col}
										{@const count = statusValue(project, col.key)}
										<span class={count > 0 ? 'text-primary' : ''}>{count}</span>
									{/each}
								</div>
							</a>

							<!-- Desktop row -->
							<div
								class="hidden md:flex items-center px-4 py-2 border-b border-edge last:border-0 hover:bg-base-hi transition-colors cursor-pointer group {isActive ? 'bg-cyan/5' : ''}"
								role="link"
								tabindex="0"
								onclick={() => goto(`/projects/${project.id}`)}
								onkeydown={(e) => e.key === 'Enter' && goto(`/projects/${project.id}`)}
								style="animation: fade-up 0.25s ease both; animation-delay: {i * 40}ms"
							>
								<span class="w-16 text-xs font-mono text-secondary/60 flex-shrink-0">{shortId(project.id)}</span>
								<span class="flex-1 text-xs font-mono text-primary truncate group-hover:text-cyan transition-colors">{project.name}</span>
								{#each TABLE_COLS as col}
									{@const count = statusValue(project, col.key)}
									<span class="w-10 text-center text-xs font-mono flex-shrink-0 {col.key === 'blocked' && count > 0 ? 'text-red' : count > 0 ? 'text-primary' : 'text-muted'}">{count}</span>
								{/each}
								<span class="w-10 text-center text-xs font-mono flex-shrink-0 {isActive ? 'text-cyan' : 'text-muted'}">{project.active_runs}</span>
								<span class="w-14 text-center text-xs font-mono flex-shrink-0 {isActive ? 'text-cyan' : 'text-muted'}">{isActive ? 'active' : 'idle'}</span>
							</div>
						{/each}
					</div>

					<!-- Summary line -->
					{#if summary}
						<div class="px-4 py-2 border-t border-edge text-xs font-mono text-muted">
							{summary}
						</div>
					{/if}

					<!-- Blinking cursor -->
					<div class="px-4 py-2">
						<span class="text-cyan font-mono text-xs">$ </span><span class="terminal-cursor"></span>
					</div>
				</div>
			</div>

			<!-- Right: Activity log -->
			<div>
				<DashboardActivityFeed entries={activity} loading={activityLoading} />
			</div>
		</div>
	{/if}
</div>
