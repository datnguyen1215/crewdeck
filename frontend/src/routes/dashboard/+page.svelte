<script lang="ts">
	import { listProjectsWithStats, type ProjectWithStats } from '$lib/api/http.js';
	import { fetchEffect } from '$lib/utils/fetch-effect.svelte.js';

	let projects = $state<ProjectWithStats[]>([]);
	let loading = $state(true);

	fetchEffect(() => listProjectsWithStats(), {
		onData: (data) => { projects = data; },
		onError: 'Failed to load dashboard',
		onLoading: (v) => { loading = v; },
	});

	let totals = $derived.by(() => {
		if (projects.length === 0) return null;
		const issues = { open: 0, in_progress: 0, pr_created: 0, pr_conflict: 0, pr_failed_actions: 0, pr_ready_to_merge: 0, done: 0 };
		let activeRuns = 0;
		let maxConcurrency = 0;
		for (const p of projects) {
			issues.open += p.issues.open;
			issues.in_progress += p.issues.in_progress;
			issues.pr_created += p.issues.pr_created;
			issues.pr_conflict += p.issues.pr_conflict;
			issues.pr_failed_actions += p.issues.pr_failed_actions;
			issues.pr_ready_to_merge += p.issues.pr_ready_to_merge;
			issues.done += p.issues.done;
			activeRuns += p.active_runs;
			maxConcurrency += p.max_concurrency;
		}
		return { issues, activeRuns, maxConcurrency };
	});

	const METRICS = [
		{ key: 'open', label: 'Open Issues', color: 'text-blue', icon: '○' },
		{ key: 'in_progress', label: 'In Progress', color: 'text-amber', icon: '◐' },
		{ key: 'pr_created', label: 'PRs Created', color: 'text-purple', icon: '⤴' },
		{ key: 'blocked', label: 'Blocked', color: 'text-red', icon: '⚠' },
		{ key: 'pr_ready_to_merge', label: 'Ready to Merge', color: 'text-green', icon: '✓' },
		{ key: 'agents', label: 'Active Agents', color: 'text-cyan', icon: '⟐' },
	] as const;
</script>

<svelte:head>
	<title>Dashboard - CrewDeck</title>
</svelte:head>

<div class="p-4 md:p-8 h-full overflow-auto pt-14 md:pt-8">
	<!-- Header -->
	<div class="mb-6 md:mb-10 fade-up">
		<h1
			class="text-lg md:text-xl font-bold text-primary uppercase tracking-wide"
		>
			DASHBOARD
		</h1>
		<p class="text-muted text-xs mt-0.5 uppercase tracking-widest">Cross-project Overview</p>
	</div>

	{#if loading}
		<!-- Skeleton grid -->
		<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
			{#each Array(6) as _, i}
				<div
					class="bg-surface border border-edge rounded-lg p-5 flex flex-col gap-3 fade-up"
					style="animation-delay: {i * 40}ms"
				>
					<div class="skeleton h-8 w-16 rounded mb-1"></div>
					<div class="skeleton h-3 w-24 rounded"></div>
				</div>
			{/each}
		</div>
	{:else if !totals}
		<!-- Empty state -->
		<div class="flex flex-col items-center justify-center py-16 md:py-24 text-center px-4">
			<p class="text-primary text-lg font-semibold mb-1">No projects yet</p>
			<p class="text-muted text-sm">Create a project to see dashboard metrics</p>
		</div>
	{:else}
		<!-- Metric cards -->
		<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
			{#each METRICS as metric, i}
				{@const rawValue = metric.key === 'agents'
					? null
					: metric.key === 'blocked'
						? totals.issues.pr_conflict + totals.issues.pr_failed_actions
						: totals.issues[metric.key as keyof typeof totals.issues]}
				{@const displayValue = metric.key === 'agents'
					? `${totals.activeRuns}/${totals.maxConcurrency}`
					: String(rawValue)}

				<div
					class="bg-surface border border-edge rounded-lg p-5 flex flex-col
						hover:border-edge-hi transition-all duration-200"
					style="animation: fade-up 0.35s ease both; animation-delay: {i * 50}ms"
				>
					<span class="text-2xl mb-1 opacity-60">{metric.icon}</span>
					<span
						class="text-2xl md:text-3xl font-bold {metric.color}"
						style={metric.key === 'blocked' && rawValue !== null && rawValue > 0 ? 'text-shadow: var(--glow-red)' : ''}
					>
						{displayValue}
					</span>
					<span class="text-muted text-xs mt-1 uppercase tracking-widest">{metric.label}</span>
				</div>
			{/each}
		</div>

		<!-- Project summary -->
		<p class="text-muted text-xs mt-6 uppercase tracking-widest fade-up">
			{projects.length} project{projects.length !== 1 ? 's' : ''}
		</p>
	{/if}
</div>
