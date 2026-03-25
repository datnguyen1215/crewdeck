<script lang="ts">
	import { getRun, type AgentRun, type AgentRunEvent } from '$lib/api/http.js';
	import { untrack } from 'svelte';
	import Modal from './Modal.svelte';
	import { RUN_STATUS_CFG } from '$lib/config/status.js';

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
				const apiEvents = full.events;
				const live = liveEvents.get(runId) ?? [];
				const apiEventIds = new Set(apiEvents.map(e => e.id));
				const newLiveEvents = live.filter(e => !apiEventIds.has(e.id));
				modalEvents = [...apiEvents, ...newLiveEvents];
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
	$effect(() => {
		if (!run) return;
		const live = liveEvents.get(run.id) ?? [];
		if (live.length === 0) return;
		// Use untrack to read modalEvents without creating a reactive dependency,
		// preventing this effect from re-running each time it updates modalEvents.
		const existingIds = new Set(untrack(() => modalEvents).map(e => e.id));
		const newEvents = live.filter(e => !existingIds.has(e.id));
		if (newEvents.length > 0) {
			modalEvents = [...untrack(() => modalEvents), ...newEvents];
		}
	});

	function formatDuration(ms: number | null): string {
		if (ms === null) return '-';
		const secs = Math.round(ms / 1000);
		if (secs < 60) return `${secs}s`;
		const mins = Math.floor(secs / 60);
		const remSecs = secs % 60;
		return `${mins}m ${remSecs}s`;
	}

	function formatCost(cost: number | null): string {
		if (cost === null) return '-';
		return `$${cost.toFixed(4)}`;
	}

	function extractToolDescription(input: Record<string, unknown> | undefined): string | null {
		if (!input) return null;
		if (typeof input.description === 'string') return input.description.slice(0, 100);
		if (typeof input.command === 'string') return input.command.slice(0, 100);
		if (typeof input.file_path === 'string') return input.file_path;
		if (typeof input.pattern === 'string') return input.pattern;
		if (typeof input.query === 'string') return input.query.slice(0, 100);
		return null;
	}

	function renderEventContent(event: AgentRunEvent): string {
		const d = event.data as Record<string, unknown>;
		switch (event.type) {
			case 'assistant': {
				if (typeof d.text === 'string') return d.text.slice(0, 200);
				if (Array.isArray(d.tool_use) && d.tool_use.length > 0) {
					const tool = d.tool_use[0] as { name: string; input: unknown };
					const desc = extractToolDescription(tool.input as Record<string, unknown>);
					return desc ? `Using ${tool.name}: ${desc}` : `Using ${tool.name}`;
				}
				return 'Text output';
			}
			case 'tool_use': {
				if (Array.isArray(d.tool_use) && d.tool_use.length > 0) {
					const tool = d.tool_use[0] as { name: string; input: unknown };
					const desc = extractToolDescription(tool.input as Record<string, unknown>);
					return desc ? `${tool.name}: ${desc}` : tool.name;
				}
				return 'Tool';
			}
			case 'tool_result': {
				if (Array.isArray(d.tool_results) && d.tool_results.length > 0) {
					const result = d.tool_results[0] as { output: string };
					if (result.output) {
						const sanitized = result.output.replace(/\n+/g, ' ').trim();
						return `Output: ${sanitized.slice(0, 100)}`;
					}
				}
				return 'Tool completed';
			}
			case 'user': {
				if (Array.isArray(d.tool_results) && d.tool_results.length > 0) {
					const result = d.tool_results[0] as { output: string };
					if (result.output) return `Tool result: ${result.output.slice(0, 100)}`;
					return 'Tool result';
				}
				return 'User input';
			}
			case 'system': {
				if (typeof d.model === 'string') return `Session started (${d.model})`;
				if (typeof d.subtype === 'string') return d.subtype;
				if (typeof d.message === 'string') return d.message.slice(0, 100);
				return 'System';
			}
			case 'result':
				return (d.result as string)?.slice(0, 100) ?? 'Finished';
			case 'error':
				return (d.error as string) ?? 'Unknown error';
			default:
				return event.type;
		}
	}
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
