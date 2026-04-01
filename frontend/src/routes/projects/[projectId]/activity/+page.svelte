<script lang="ts">
	import { page } from '$app/stores';
	import { getContext } from 'svelte';
	import { listActivity, listIssues, getProject, type ActivityLog, type IssueWithRunningAgent, type Agent, type Project } from '$lib/api/http.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import { ACTOR_CFG, ACTION_DISPLAY } from '$lib/activity.js';
	import ActivityTimeline from '$lib/components/ActivityTimeline.svelte';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';

	type ActivityEntry = ActivityLog;

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');
	const getAgents = getContext<() => Agent[]>('agents');

	// Client-side pagination over fetched entries.
	const PAGE_SIZE = 50;

	let projectId = $derived($page.params.projectId!);
	let project = $state<Project | null>(null);
	let pageTitle = $derived(project?.name ? `Activity - ${project.name} - CrewDeck` : 'Activity - CrewDeck');
	let allEntries = $state<ActivityEntry[]>([]);
	let issues = $state<IssueWithRunningAgent[]>([]);
	let agents = $derived(getAgents());
	let loading = $state(true);
	let visibleCount = $state(PAGE_SIZE);

	let filterActors = $state<string[]>([]);
	let filterAction = $state('');
	let filterIssue = $state('');
	let expanded = $state<Set<string>>(new Set());

	$effect(() => {
		loading = true;
		visibleCount = PAGE_SIZE;
		let cancelled = false;
		// Pass active filters server-side so the limit is applied after filtering,
		// preventing silent exclusion of matching entries beyond the fetch limit.
		const actParams: Record<string, unknown> = { limit: 500 };
		if (filterActors.length > 0) actParams.actor_type = filterActors[0];
		if (filterAction) actParams.action = filterAction;
		if (filterIssue) actParams.issue_id = filterIssue;
		Promise.all([listActivity(projectId, actParams), listIssues(projectId)])
			.then(([acts, iss]) => {
				if (cancelled) return;
				allEntries = acts;
				issues = iss;
			})
			.catch(() => { if (!cancelled) toastStore.add('Failed to load activity', 'error'); })
			.finally(() => { if (!cancelled) loading = false; });
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		let cancelled = false;
		getProject(projectId)
			.then((p) => { if (!cancelled) project = p; })
			.catch((err) => { if (!cancelled) toastStore.add(err instanceof Error ? err.message : 'Failed to load project', 'error'); });
		return () => { cancelled = true; };
	});

	$effect(() => {
		const ws = getWs();
		if (!ws) return;
		const reload = () => {
			const actParams: Record<string, unknown> = { limit: 500 };
			if (filterActors.length > 0) actParams.actor_type = filterActors[0];
			if (filterAction) actParams.action = filterAction;
			if (filterIssue) actParams.issue_id = filterIssue;
			Promise.all([listActivity(projectId, actParams), listIssues(projectId)]).then(
				([acts, iss]) => {
					allEntries = acts;
					issues = iss;
				}
			).catch((err) => { toastStore.add(err instanceof Error ? err.message : 'Failed to load activity', 'error'); });
		};
		const unsub = ws.on('*', reload);
		return () => unsub();
	});

	// Filtering is applied server-side; allEntries already reflects active filters.
	let filtered = $derived(allEntries);

	let visible = $derived(filtered.slice(0, visibleCount));
	let hasMore = $derived(filtered.length > visibleCount);

	// Unique action types present in this project's data, for the filter dropdown.
	let actionTypes = $derived([...new Set(allEntries.map((e) => e.action))].sort());
	let issueMap = $derived(Object.fromEntries(issues.map((i) => [i.id, i.title])));


	function toggleActor(actor: string) {
		filterActors = filterActors.includes(actor)
			? filterActors.filter((a) => a !== actor)
			: [...filterActors, actor];
		visibleCount = PAGE_SIZE;
	}

	function toggleExpand(id: string) {
		const next = new Set(expanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expanded = next;
	}

	function clearFilters() {
		filterActors = [];
		filterAction = '';
		filterIssue = '';
		visibleCount = PAGE_SIZE;
	}


</script>

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

<div class="p-4 md:p-6 h-full overflow-auto pt-14 md:pt-6">
	<!-- Breadcrumb -->
	<div class="mb-4 md:mb-5">
		<Breadcrumb segments={[
			{ label: 'Projects', href: '/' },
			{ label: project?.name ?? 'Project', href: `/projects/${projectId}` },
			{ label: 'Activity' }
		]} />
	</div>

	<!-- Header -->
	<div class="flex items-center justify-between mb-5">
		<div>
			<h1 class="text-lg md:text-xl font-bold text-primary uppercase tracking-wide">Activity</h1>
			<p class="text-muted text-xs mt-0.5">
				{#if !loading}
					{filtered.length} event{filtered.length !== 1 ? 's' : ''}
				{:else}
					Loading…
				{/if}
			</p>
		</div>
	</div>

	<!-- Filters -->
	<div class="mb-6 space-y-3">
		<!-- Actor type toggle pills -->
		<div class="flex flex-wrap items-center gap-1.5">
			<span class="text-xs text-muted uppercase tracking-widest mr-1 flex-shrink-0 w-full sm:w-auto mb-1 sm:mb-0">Actor:</span>
			{#each Object.entries(ACTOR_CFG) as [type, cfg] (type)}
				<button
					onclick={() => toggleActor(type)}
					class="px-2.5 py-1.5 sm:py-0.5 text-xs rounded border transition-colors min-h-[36px] sm:min-h-0 {filterActors.includes(type)
						? `${cfg.color} ${cfg.border} bg-surface-hi`
						: 'text-muted border-edge hover:border-edge-hi hover:text-secondary'}"
				>
					{cfg.icon}
					{type.charAt(0).toUpperCase() + type.slice(1)}
				</button>
			{/each}
		</div>

		<!-- Action + Issue selects -->
		<div class="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 flex-wrap">
			<div class="flex items-center gap-2">
				<span class="text-xs text-muted uppercase tracking-widest">Action:</span>
				<select
					bind:value={filterAction}
					onchange={() => (visibleCount = PAGE_SIZE)}
					class="bg-surface border border-edge text-secondary text-xs rounded px-2 py-2 sm:py-1 hover:border-edge-hi transition-colors cursor-pointer outline-none min-h-[36px] sm:min-h-0"
				>
					<option value="">All</option>
					{#each actionTypes as action (action)}
						<option value={action}>{ACTION_DISPLAY[action] ?? action}</option>
					{/each}
				</select>
			</div>

			<div class="flex items-center gap-2">
				<span class="text-xs text-muted uppercase tracking-widest">Issue:</span>
				<select
					bind:value={filterIssue}
					onchange={() => (visibleCount = PAGE_SIZE)}
					class="bg-surface border border-edge text-secondary text-xs rounded px-2 py-2 sm:py-1 hover:border-edge-hi transition-colors cursor-pointer outline-none max-w-[180px] min-h-[36px] sm:min-h-0"
				>
					<option value="">All</option>
					{#each issues as issue (issue.id)}
						<option value={issue.id}>{issue.title}</option>
					{/each}
				</select>
			</div>

			{#if filterActors.length > 0 || filterAction || filterIssue}
				<button
					onclick={clearFilters}
					class="px-3 py-1.5 text-xs text-muted hover:text-secondary border border-edge hover:border-edge-hi rounded transition-colors self-start"
				>
					Clear ×
				</button>
			{/if}
		</div>
	</div>

	<!-- Timeline -->
	{#if loading}
		<!-- Skeleton timeline while activity loads -->
		{@const skeletonWidths = [75, 55, 85, 65, 90, 60, 70, 80]}
		<div class="max-w-2xl relative fade-up">
			<div class="absolute left-[19px] top-2 bottom-0 w-px bg-edge pointer-events-none"></div>
			<div class="flex flex-col">
				{#each Array(8) as _, i}
					<div
						class="flex gap-4 pb-5 relative fade-up"
						style="animation-delay: {i * 40}ms"
					>
						<div class="flex-shrink-0 w-10 flex justify-center pt-0.5">
							<div class="skeleton w-6 h-6 rounded-full"></div>
						</div>
						<div class="flex-1 pt-0.5">
							<div class="flex items-center gap-2 mb-1.5">
								<div class="skeleton h-3 w-16 rounded"></div>
								<div class="skeleton h-3 w-12 rounded"></div>
							</div>
							<div class="skeleton h-4 rounded" style="width: {skeletonWidths[i]}%"></div>
							{#if i % 3 === 0}
								<div class="skeleton h-3 w-32 rounded mt-1.5"></div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{:else if filtered.length === 0}
		<p class="text-muted text-sm py-16 text-center">No activity matches the current filters.</p>
	{:else}
			<div class="max-w-2xl">
				<ActivityTimeline
					entries={visible}
					{expanded}
					onToggleExpand={toggleExpand}
					{projectId}
					{issueMap}
					showRecentGlow={true}
					compact={false}
					highlightHandoffs={true}
					{filterIssue}
				/>

				<!-- Load more -->
				{#if hasMore}
					<div class="pl-10 md:pl-14 pb-4">
						<button
							onclick={() => (visibleCount += PAGE_SIZE)}
							class="text-xs text-muted hover:text-secondary border border-edge hover:border-edge-hi rounded px-4 py-2.5 sm:py-1.5 transition-colors min-h-[44px] sm:min-h-0"
						>
							Load more ({filtered.length - visibleCount} remaining)
						</button>
					</div>
				{/if}
			</div>
	{/if}
</div>
