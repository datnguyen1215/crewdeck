<script lang="ts">
	import { getRun, type AgentRun, type AgentRunEvent } from '$lib/api/http.js';
	import Modal from './Modal.svelte';
	import { RUN_STATUS_CFG } from '$lib/config/status.js';
	import { formatDuration, formatCost } from '$lib/utils/format.js';
	import { renderEventContent } from '$lib/utils/event.js';
	import { mergeWithLiveEvents, createLiveEventSync } from '$lib/utils/run-events.svelte.js';

	let {
		run,
		liveEvents,
		onClose
	}: {
		run: AgentRun | null;
		liveEvents: Map<string, AgentRunEvent[]>;
		onClose: () => void;
	} = $props();

	let modalEvents = $state<AgentRunEvent[]>([]);
	let modalLoading = $state(false);

	// Load events when run changes
	$effect(() => {
		if (!run) { modalEvents = []; return; }
		const runId = run.id;
		modalLoading = true;
		getRun(run.project_id, runId)
			.then((full) => {
				// Guard against stale responses if the user switched runs before this resolved
				if (runId !== run?.id) return;
				modalEvents = mergeWithLiveEvents(full.events, liveEvents, runId);
			})
			.catch(() => {
				if (runId !== run?.id) return;
				modalEvents = liveEvents.get(runId) ?? [];
			})
			.finally(() => {
				modalLoading = false;
			});
	});

	// Live-update modal events when new run events stream in
	$effect(createLiveEventSync(
		() => liveEvents,
		() => run?.id ?? null,
		() => modalEvents,
		(e) => { modalEvents = e; }
	));

</script>

<Modal open={run !== null} {onClose} label="View Run" maxWidth="max-w-2xl">
	{#if run}
		{@const runCfg = RUN_STATUS_CFG[run.status] ?? RUN_STATUS_CFG.queued}
		<div class="flex items-center gap-3 mb-4">
			<h2 class="text-lg font-semibold text-primary">Run Details</h2>
			<span class="text-xs px-1.5 py-0.5 rounded border {runCfg.class}" class:animate-pulse={runCfg.pulse}>{runCfg.label}</span>
			<span class="text-xs text-muted ml-auto">{formatDuration(run.duration_ms)} | {formatCost(run.cost_usd)}</span>
		</div>
		<div class="max-h-96 overflow-y-auto border border-edge rounded p-3 bg-base">
			{#if modalLoading}
				<div class="animate-pulse text-xs text-muted">Loading events...</div>
			{:else if modalEvents.length === 0}
				<p class="text-xs text-muted">No events recorded.</p>
			{:else}
				<div class="flex flex-col gap-2 text-xs">
					{#each modalEvents as event (event.id)}
						<div class="flex gap-2">
							<span class="shrink-0 w-20 text-muted font-mono">{event.type}</span>
							<span class="text-secondary break-all">{renderEventContent(event)}</span>
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
</Modal>
