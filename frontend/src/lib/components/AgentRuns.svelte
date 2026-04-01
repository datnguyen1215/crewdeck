<script lang="ts">
	import { getContext } from 'svelte';
	import { listIssueRuns, getRun, type AgentRun, type AgentRunWithEvents, type AgentRunEvent } from '$lib/api/http.js';
	import { smartTime, fullTime } from '$lib/utils/time.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import { RUN_STATUS_CFG } from '$lib/config/status.js';
	import { useWsSubscriptions } from '$lib/utils/ws-subscriptions.js';
	import { formatDuration, formatCost } from '$lib/utils/format.js';
	import { renderEventContent } from '$lib/utils/event.js';
	import { createRunEventHandlers, mergeWithLiveEvents, createLiveEventSync } from '$lib/utils/run-events.svelte.js';

	let { projectId, issueId }: { projectId: string; issueId: string } = $props();

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

	let runs = $state<AgentRun[]>([]);
	let loading = $state(true);
	let expandedRun = $state<string | null>(null);
	let expandedEvents = $state<AgentRunEvent[]>([]);
	let loadingEvents = $state(false);

	// Live streaming events for active runs
	let liveEvents = $state<Map<string, AgentRunEvent[]>>(new Map());

	$effect(() => {
		loadRuns();
	});

	$effect(() => {
		const ws = getWs();
		if (!ws) return;

		const { handleRunStarted, handleRunEvent, handleRunCompleted } = createRunEventHandlers(
			issueId, projectId,
			() => runs, (r) => { runs = r; },
			() => liveEvents, (m) => { liveEvents = m; }
		);

		return useWsSubscriptions(ws, {
			'run.started': handleRunStarted,
			'run.event': handleRunEvent,
			'run.completed': handleRunCompleted,
		});
	});

	// Keep expanded events in sync with live events
	$effect(createLiveEventSync(
		() => liveEvents,
		() => expandedRun,
		() => expandedEvents,
		(e) => { expandedEvents = e; }
	));

	async function loadRuns() {
		loading = true;
		try {
			runs = await listIssueRuns(projectId, issueId);
		} catch {
			runs = [];
			toastStore.add('Failed to load agent runs', 'error');
		} finally {
			loading = false;
		}
	}

	async function toggleExpand(runId: string) {
		if (expandedRun === runId) {
			expandedRun = null;
			expandedEvents = [];
			return;
		}

		expandedRun = runId;

		// Always fetch stored events from API first
		loadingEvents = true;
		try {
			const full = await getRun(projectId, runId);
			expandedEvents = mergeWithLiveEvents(full.events, liveEvents, runId);
		} catch {
			// Fallback to live events only if API fails
			expandedEvents = liveEvents.get(runId) ?? [];
			toastStore.add('Failed to load run events', 'error');
		} finally {
			loadingEvents = false;
		}
	}

</script>

{#if loading}
	<div class="flex flex-col gap-3">
		{#each Array(3) as _, i}
			<div class="animate-pulse flex gap-3" style="animation-delay: {i * 50}ms">
				<div class="skeleton h-4 w-20 rounded"></div>
				<div class="skeleton h-4 flex-1 rounded"></div>
			</div>
		{/each}
	</div>
{:else if runs.length === 0}
	<p class="text-muted text-sm py-8 text-center">No agent runs yet.</p>
{:else}
	<div class="flex flex-col gap-2">
		{#each runs as run (run.id)}
			{@const cfg = RUN_STATUS_CFG[run.status] ?? RUN_STATUS_CFG.queued}
			<div class="border border-edge rounded overflow-hidden">
				<button
					onclick={() => toggleExpand(run.id)}
					class="w-full flex items-center gap-3 px-3 py-2 hover:bg-surface-hi transition-colors text-left"
				>
					<span
						class="text-xs px-1.5 py-0.5 rounded border {cfg.class}"
						class:animate-pulse={cfg.pulse}
					>
						{cfg.label}
					</span>
					<span class="text-sm text-secondary font-medium capitalize">{run.agent_id}</span>
					<span class="text-xs text-muted ml-auto">
						{formatDuration(run.duration_ms)} | {formatCost(run.cost_usd)}
					</span>
					<span class="text-xs text-muted" title={fullTime(run.created_at)}>
						{smartTime(run.created_at)}
					</span>
					<span class="text-muted">{expandedRun === run.id ? '\u25B2' : '\u25BC'}</span>
				</button>

				{#if expandedRun === run.id}
					<div class="border-t border-edge bg-base p-3 max-h-80 overflow-y-auto">
						{#if loadingEvents}
							<div class="animate-pulse text-xs text-muted">Loading events...</div>
						{:else if expandedEvents.length === 0}
							<p class="text-xs text-muted">No events recorded.</p>
						{:else}
							<div class="flex flex-col gap-2 text-xs">
								{#each expandedEvents as event (event.id)}
									<div class="flex gap-2">
										<span class="shrink-0 w-20 text-muted font-mono">{event.type}</span>
										<span class="text-secondary break-all">
											{renderEventContent(event)}
										</span>
									</div>
								{/each}
								{#if run.status === 'running'}
									<div class="flex gap-2 animate-pulse">
										<span class="shrink-0 w-20 text-green font-mono">...</span>
										<span class="text-green">Processing</span>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}
