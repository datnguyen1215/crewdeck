<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { listProjectsWithStats, listGlobalActivity, type ProjectWithStats, type ActivityLog } from '$lib/api/http.js';
	import { fetchEffect } from '$lib/utils/fetch-effect.svelte.js';
	import DashboardActivityFeed from '$lib/components/DashboardActivityFeed.svelte';

	let projects = $state<ProjectWithStats[]>([]);
	let loading = $state(true);
	let activity = $state<ActivityLog[]>([]);
	let activityLoading = $state(true);

	fetchEffect(() => listProjectsWithStats(), {
		onData: (data) => { projects = data; },
		onError: 'Failed to load dashboard',
		onLoading: (v) => { loading = v; },
	});

	async function refreshActivity() {
		const isInitialLoad = activity.length === 0;
		if (isInitialLoad) activityLoading = true;
		try {
			activity = await listGlobalActivity({ limit: 10 });
		} catch {}
		activityLoading = false;
	}

	refreshActivity();

	const POLL_INTERVAL = 15_000;
	let pollTimer = setInterval(refreshActivity, POLL_INTERVAL);
	onDestroy(() => clearInterval(pollTimer));

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

	const TABLE_COLS = [
		{ key: 'open', label: 'Open', color: 'text-blue', barColor: 'bg-blue' },
		{ key: 'in_progress', label: 'In Progress', color: 'text-amber', barColor: 'bg-amber' },
		{ key: 'pr_created', label: 'PR', color: 'text-purple', barColor: 'bg-purple' },
		{ key: 'blocked', label: 'Blocked', color: 'text-red', barColor: 'bg-red' },
		{ key: 'pr_ready_to_merge', label: 'Ready', color: 'text-green', barColor: 'bg-green' },
		{ key: 'done', label: 'Done', color: 'text-secondary', barColor: 'bg-secondary' },
	] as const;

	function blockedCount(issues: ProjectWithStats['issues']) {
		return issues.pr_conflict + issues.pr_failed_actions;
	}

	function totalIssues(issues: ProjectWithStats['issues']) {
		return Object.values(issues).reduce((a, b) => a + b, 0);
	}

	function statusValue(p: ProjectWithStats, key: string): number {
		if (key === 'blocked') return blockedCount(p.issues);
		return p.issues[key as keyof typeof p.issues] ?? 0;
	}
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
		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<div class="lg:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-4">
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
			<div class="bg-surface border border-edge rounded-lg p-5">
				<div class="skeleton h-3 w-32 rounded mb-4"></div>
				{#each Array(4) as _}
					<div class="flex gap-3 mb-3">
						<div class="skeleton w-5 h-5 rounded-full"></div>
						<div class="flex-1">
							<div class="skeleton h-3 w-20 rounded mb-1.5"></div>
							<div class="skeleton h-3 w-36 rounded"></div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{:else if !totals}
		<!-- Empty state -->
		<div class="flex flex-col items-center justify-center py-16 md:py-24 text-center px-4">
			<p class="text-primary text-lg font-semibold mb-1">No projects yet</p>
			<p class="text-muted text-sm">Create a project to see dashboard metrics</p>
		</div>
	{:else}
		<!-- Two-column layout: cards + activity feed -->
		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<!-- Left: Metric cards + project breakdown -->
			<div class="lg:col-span-2">
				<div class="grid grid-cols-2 md:grid-cols-3 gap-4">
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

				<!-- Project Breakdown Section -->
				<div class="mt-8 fade-up" style="animation: fade-up 0.35s ease both; animation-delay: 350ms">
					<div class="flex items-center justify-between mb-4">
						<h2 class="text-primary font-semibold text-sm uppercase tracking-widest">
							Projects Breakdown
						</h2>
						<span class="text-muted text-xs">{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
					</div>

					{#if projects.length === 0}
						<div class="bg-surface border border-edge rounded-lg py-10 text-center">
							<p class="text-muted text-sm">No projects to display</p>
						</div>
					{:else}
						<!-- Mobile card view -->
						<div class="flex flex-col gap-3 md:hidden">
							{#each projects as project, i (project.id)}
								{@const blocked = blockedCount(project.issues)}
								{@const total = totalIssues(project.issues)}
								<a
									href="/projects/{project.id}"
									class="block bg-surface border border-edge rounded-lg p-4 hover:border-edge-hi transition-all duration-200 active:scale-[0.99]"
									style="animation: fade-up 0.3s ease both; animation-delay: {i * 40}ms"
								>
									<div class="flex items-center justify-between mb-2">
										<span class="text-primary font-semibold text-sm truncate mr-2">{project.name}</span>
										<span class="text-muted text-xs flex-shrink-0">{project.active_runs}/{project.max_concurrency} agents</span>
									</div>
									{#if total > 0}
										<div class="flex h-1.5 rounded-full overflow-hidden gap-px mb-3">
											{#each TABLE_COLS as col}
												{@const count = statusValue(project, col.key)}
												{#if count > 0}
													<div class="{col.barColor} rounded-full" style="flex: {count}" title="{col.label}: {count}"></div>
												{/if}
											{/each}
										</div>
									{/if}
									<div class="flex gap-3 text-xs">
										{#each TABLE_COLS as col}
											{@const count = statusValue(project, col.key)}
											<span class={col.key === 'blocked' && blocked > 0 ? col.color : count > 0 ? 'text-primary' : 'text-muted'}>
												{count} <span class="text-muted">{col.label}</span>
											</span>
										{/each}
									</div>
								</a>
							{/each}
						</div>

						<!-- Desktop table view -->
						<div class="hidden md:block overflow-x-auto border border-edge rounded">
							<table class="w-full min-w-[700px] text-sm">
								<thead>
									<tr class="text-xs text-muted uppercase tracking-widest bg-base-hi border-b border-edge">
										<th class="text-left px-4 py-2.5 font-medium">Project</th>
										{#each TABLE_COLS as col}
											<th class="text-center px-3 py-2.5 font-medium">{col.label}</th>
										{/each}
										<th class="text-center px-3 py-2.5 font-medium">Agents</th>
									</tr>
								</thead>
								<tbody>
									{#each projects as project, i (project.id)}
										{@const blocked = blockedCount(project.issues)}
										{@const total = totalIssues(project.issues)}
										<tr
											class="border-b border-edge last:border-0 hover:bg-surface-hi transition-colors cursor-pointer group {i % 2 === 1 ? 'bg-base-hi' : 'bg-base'}"
											role="link"
											tabindex="0"
											onclick={() => goto(`/projects/${project.id}`)}
											onkeydown={(e) => e.key === 'Enter' && goto(`/projects/${project.id}`)}
											style="animation: fade-up 0.25s ease both; animation-delay: {350 + i * 40}ms"
										>
											<td class="px-4 py-3">
												<div class="flex flex-col gap-1 min-w-0">
													<span class="text-primary font-semibold truncate group-hover:text-cyan transition-colors">{project.name}</span>
													{#if total > 0}
														<div class="flex h-1 rounded-full overflow-hidden gap-px w-full max-w-[160px]">
															{#each TABLE_COLS as col}
																{@const count = statusValue(project, col.key)}
																{#if count > 0}
																	<div class="{col.barColor} rounded-full" style="flex: {count}"></div>
																{/if}
															{/each}
														</div>
													{/if}
												</div>
											</td>
											{#each TABLE_COLS as col}
												{@const count = statusValue(project, col.key)}
												<td class="text-center px-3 py-3">
													<span class={col.key === 'blocked' && blocked > 0 ? col.color + ' font-medium' : count > 0 ? 'text-primary' : 'text-muted'}>
														{count}
													</span>
												</td>
											{/each}
											<td class="text-center px-3 py-3 text-muted">
												<span class="text-secondary">{project.active_runs}</span>/{project.max_concurrency}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</div>
			</div>

			<!-- Right: Activity feed -->
			<div>
				<DashboardActivityFeed entries={activity} loading={activityLoading} />
			</div>
		</div>
	{/if}
</div>
