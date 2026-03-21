<script lang="ts">
	import { page } from '$app/stores';
	import { getContext, onMount } from 'svelte';
	import { listProjectRuns, listAgents, listIssues, type AgentRun, type Agent, type Issue } from '$lib/api/http.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import { parseUTC } from '$lib/utils/time.js';

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

	let projectId = $derived($page.params.projectId!);
	let open = $state(false);
	let runs = $state<AgentRun[]>([]);
	let agents = $state<Agent[]>([]);
	let issues = $state<Issue[]>([]);
	let loading = $state(true);

	// Filter to active runs (running or queued)
	let activeRuns = $derived(runs.filter(r => r.status === 'running' || r.status === 'queued'));
	let runningCount = $derived(activeRuns.filter(r => r.status === 'running').length);
	let queuedCount = $derived(activeRuns.filter(r => r.status === 'queued').length);
	let totalCount = $derived(runningCount + queuedCount);

	// Maps for lookups
	let agentMap = $derived(Object.fromEntries(agents.map(a => [a.id, a])));
	let issueMap = $derived(Object.fromEntries(issues.map(i => [i.id, i])));

	async function loadData() {
		try {
			const [r, a, i] = await Promise.all([
				listProjectRuns(projectId, { limit: 100 }),
				listAgents(),
				listIssues(projectId)
			]);
			runs = r;
			agents = a;
			issues = i;
		} catch {
			// Ignore errors
		} finally {
			loading = false;
		}
	}

	onMount(loadData);

	// Reload on relevant WS events
	$effect(() => {
		const ws = getWs();
		if (!ws) return;
		const unsubs = [
			ws.on('run.started', loadData),
			ws.on('run.completed', loadData),
			ws.on('dispatch.queued', loadData),
			ws.on('dispatch.dequeued', loadData),
		];
		return () => unsubs.forEach(fn => fn());
	});

	function formatDuration(startedAt: string | null): string {
		if (!startedAt) return '0s';
		const ms = Date.now() - parseUTC(startedAt).getTime();
		const secs = Math.floor(ms / 1000);
		const mins = Math.floor(secs / 60);
		if (mins > 0) return `${mins}m ${secs % 60}s`;
		return `${secs}s`;
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.queue-monitor')) {
			open = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
	}
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

<div class="queue-monitor relative">
	<button
		onclick={() => open = !open}
		class="flex items-center gap-1.5 px-2 py-1.5 rounded border transition-colors
			{totalCount > 0
				? 'border-cyan/50 text-cyan hover:border-cyan hover:bg-cyan/10'
				: 'border-edge text-muted hover:border-edge-hi hover:text-secondary'}"
		title="Queue monitor"
	>
		<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
			<line x1="3" y1="9" x2="21" y2="9"/>
			<line x1="9" y1="21" x2="9" y2="9"/>
		</svg>
		{#if totalCount > 0}
			<span class="text-xs font-medium tabular-nums">{totalCount}</span>
		{/if}
	</button>

	{#if open}
		<div class="absolute right-0 top-full mt-2 w-80 bg-surface border border-edge rounded shadow-lg z-50 fade-up">
			<div class="px-3 py-2 border-b border-edge">
				<div class="flex items-center justify-between">
					<span class="text-xs text-muted uppercase tracking-widest">Queue Monitor</span>
					<div class="flex items-center gap-2 text-xs">
						{#if runningCount > 0}
							<span class="text-green">{runningCount} running</span>
						{/if}
						{#if queuedCount > 0}
							<span class="text-amber">{queuedCount} queued</span>
						{/if}
						{#if totalCount === 0}
							<span class="text-muted">idle</span>
						{/if}
					</div>
				</div>
			</div>

			<div class="max-h-64 overflow-y-auto">
				{#if loading}
					<div class="px-3 py-4 text-center text-muted text-sm">Loading...</div>
				{:else if activeRuns.length === 0}
					<div class="px-3 py-4 text-center text-muted text-sm">No active agents</div>
				{:else}
					{#each activeRuns as run, i (run.id)}
						{@const agent = agentMap[run.agent_id]}
						{@const issue = issueMap[run.issue_id]}
						{@const isRunning = run.status === 'running'}
						{@const queuePosition = !isRunning ? activeRuns.filter(r => r.status === 'queued').indexOf(run) + 1 : 0}
						<a
							href="/projects/{projectId}/issues/{run.issue_id}"
							onclick={() => open = false}
							class="block px-3 py-2 hover:bg-surface-hi transition-colors border-b border-edge last:border-0"
						>
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0 flex-1">
									<p class="text-sm text-primary truncate">{issue?.title ?? 'Unknown issue'}</p>
									<p class="text-xs text-muted mt-0.5">{agent?.name ?? run.agent_id}</p>
								</div>
								<div class="flex-shrink-0 text-right">
									{#if isRunning}
										<span class="inline-flex items-center gap-1 text-xs text-green">
											<span class="w-1.5 h-1.5 rounded-full bg-green animate-pulse"></span>
											{formatDuration(run.started_at)}
										</span>
									{:else}
										<span class="inline-flex items-center gap-1 text-xs text-amber">
											<span class="w-1.5 h-1.5 rounded-full bg-amber"></span>
											#{queuePosition}
										</span>
									{/if}
								</div>
							</div>
						</a>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.fade-up {
		animation: fadeUp 0.15s ease-out;
	}

	@keyframes fadeUp {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
