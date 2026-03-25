<script lang="ts">
	import { getContext } from 'svelte';
	import { listIssueRuns, getRun, type AgentRun, type AgentRunWithEvents, type AgentRunEvent } from '$lib/api/http.js';
	import { relTime, parseUTC } from '$lib/utils/time.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';

	let { projectId, issueId }: { projectId: string; issueId: string } = $props();

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

	let runs = $state<AgentRun[]>([]);
	let loading = $state(true);
	let expandedRun = $state<string | null>(null);
	let expandedEvents = $state<AgentRunEvent[]>([]);
	let loadingEvents = $state(false);

	// Live streaming events for active runs
	let liveEvents = $state<Map<string, AgentRunEvent[]>>(new Map());

	const STATUS_CFG: Record<string, { label: string; class: string; pulse?: boolean }> = {
		queued: { label: 'Queued', class: 'text-muted border-edge' },
		running: { label: 'Running', class: 'text-green border-green', pulse: true },
		completed: { label: 'Completed', class: 'text-cyan border-cyan' },
		failed: { label: 'Failed', class: 'text-red border-red' },
		timeout: { label: 'Timeout', class: 'text-amber border-amber' }
	};

	$effect(() => {
		loadRuns();
	});

	$effect(() => {
		const ws = getWs();
		if (!ws) return;

		const handleRunStarted = (data: Record<string, unknown>) => {
			if (data.issue_id !== issueId) return;
			// Add new run to list
			const newRun: AgentRun = {
				id: data.agent_run_id as string,
				project_id: projectId,
				issue_id: issueId,
				agent_id: data.agent_id as string,
				pid: null,
				status: data.status as AgentRun['status'],
				exit_code: null,
				cost_usd: null,
				duration_ms: null,
				started_at: data.started_at as string | null,
				completed_at: null,
				created_at: new Date().toISOString()
			};
			runs = [newRun, ...runs];
			liveEvents.set(newRun.id, []);
		};

		const handleRunEvent = (data: Record<string, unknown>) => {
			const runId = data.agent_run_id as string;
			const run = runs.find(r => r.id === runId);
			if (!run || run.issue_id !== issueId) return;

			const event: AgentRunEvent = {
				id: data.event_id as string,
				agent_run_id: runId,
				type: data.type as AgentRunEvent['type'],
				data: data.data,
				created_at: data.created_at as string
			};

			const existing = liveEvents.get(runId) ?? [];
			liveEvents.set(runId, [...existing, event]);
			liveEvents = new Map(liveEvents);

			// If this run is expanded, append only if not already present (dedupe by ID)
			if (expandedRun === runId && !expandedEvents.some(e => e.id === event.id)) {
				expandedEvents = [...expandedEvents, event];
			}
		};

		const handleRunCompleted = (data: Record<string, unknown>) => {
			const runId = data.agent_run_id as string;
			runs = runs.map(r => {
				if (r.id !== runId) return r;
				return {
					...r,
					status: data.status as AgentRun['status'],
					exit_code: data.exit_code as number | null,
					cost_usd: data.cost_usd as number | null,
					duration_ms: data.duration_ms as number | null,
					completed_at: data.completed_at as string
				};
			});
		};

		const unsubs = [
			ws.on('run.started', handleRunStarted),
			ws.on('run.event', handleRunEvent),
			ws.on('run.completed', handleRunCompleted)
		];

		return () => unsubs.forEach(fn => fn());
	});

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
			const apiEvents = full.events;

			// Merge with live events, deduplicating by ID
			// (handles race condition where event is both fetched and received via WS)
			const live = liveEvents.get(runId) ?? [];
			const apiEventIds = new Set(apiEvents.map(e => e.id));
			const newLiveEvents = live.filter(e => !apiEventIds.has(e.id));
			expandedEvents = [...apiEvents, ...newLiveEvents];
		} catch {
			// Fallback to live events only if API fails
			expandedEvents = liveEvents.get(runId) ?? [];
			toastStore.add('Failed to load run events', 'error');
		} finally {
			loadingEvents = false;
		}
	}

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
				// Normalized: d.text, d.tool_use[]
				if (typeof d.text === 'string') return d.text.slice(0, 200);
				if (Array.isArray(d.tool_use) && d.tool_use.length > 0) {
					const tool = d.tool_use[0] as { name: string; input: unknown };
					const desc = extractToolDescription(tool.input as Record<string, unknown>);
					return desc ? `Using ${tool.name}: ${desc}` : `Using ${tool.name}`;
				}
				return 'Text output';
			}
			case 'tool_use': {
				// Normalized: d.tool_use[]
				if (Array.isArray(d.tool_use) && d.tool_use.length > 0) {
					const tool = d.tool_use[0] as { name: string; input: unknown };
					const desc = extractToolDescription(tool.input as Record<string, unknown>);
					return desc ? `${tool.name}: ${desc}` : tool.name;
				}
				return 'Tool';
			}
			case 'tool_result': {
				// Normalized: d.tool_results[]
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
				// Normalized: d.tool_results[]
				if (Array.isArray(d.tool_results) && d.tool_results.length > 0) {
					const result = d.tool_results[0] as { output: string };
					if (result.output) {
						return `Tool result: ${result.output.slice(0, 100)}`;
					}
					return 'Tool result';
				}
				return 'User input';
			}
			case 'system': {
				// Normalized: d.model, d.subtype, d.message
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
			{@const cfg = STATUS_CFG[run.status] ?? STATUS_CFG.queued}
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
					<span class="text-xs text-muted" title={parseUTC(run.created_at).toLocaleString()}>
						{relTime(run.created_at)}
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
