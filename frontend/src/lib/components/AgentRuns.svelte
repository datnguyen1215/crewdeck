<script lang="ts">
	import { getContext } from 'svelte';
	import { listIssueRuns, getRun, type AgentRun, type AgentRunWithEvents, type AgentRunEvent } from '$lib/api/http.js';
	import { relTime, parseUTC } from '$lib/utils/time.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';

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
				id: crypto.randomUUID(),
				agent_run_id: runId,
				type: data.type as AgentRunEvent['type'],
				data: data.data,
				created_at: new Date().toISOString()
			};

			const existing = liveEvents.get(runId) ?? [];
			liveEvents.set(runId, [...existing, event]);
			liveEvents = new Map(liveEvents);

			// If this run is expanded, update expanded events
			if (expandedRun === runId) {
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

			// Merge with live events that arrived after the last API event
			// (handles race condition where event is both fetched and received via WS)
			const live = liveEvents.get(runId) ?? [];
			const lastApiTime = apiEvents.length > 0
				? new Date(apiEvents[apiEvents.length - 1].created_at).getTime()
				: 0;
			const newLiveEvents = live.filter(e => new Date(e.created_at).getTime() > lastApiTime);
			expandedEvents = [...apiEvents, ...newLiveEvents];
		} catch {
			// Fallback to live events only if API fails
			expandedEvents = liveEvents.get(runId) ?? [];
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

	function renderEventContent(event: AgentRunEvent): string {
		const data = event.data as Record<string, unknown>;
		switch (event.type) {
			case 'assistant':
				return extractAssistantText(data);
			case 'tool_use':
				return extractToolUse(data);
			case 'tool_result':
				return extractToolResult(data);
			case 'result':
				return (data.result as string)?.slice(0, 100) ?? 'Finished';
			case 'system':
				return extractSystemInfo(data);
			default:
				return event.type;
		}
	}

	function extractAssistantText(data: Record<string, unknown>): string {
		// Flat format: data.text or data.content
		if (typeof data.text === 'string') return data.text.slice(0, 200);
		if (typeof data.content === 'string') return data.content.slice(0, 200);

		// Flat array format: data.content[]
		if (Array.isArray(data.content)) {
			const textBlock = data.content.find((c: any) => c.type === 'text');
			if (textBlock?.text) return textBlock.text.slice(0, 200);
		}

		// Nested format: data.message.content[]
		const message = data.message as Record<string, unknown> | undefined;
		if (message && Array.isArray(message.content)) {
			const textBlock = message.content.find((c: any) => c.type === 'text');
			if (textBlock?.text) return (textBlock.text as string).slice(0, 200);
		}

		return 'Text output';
	}

	function extractToolUse(data: Record<string, unknown>): string {
		// Flat format: data.name
		if (typeof data.name === 'string') {
			const desc = extractToolDescription(data);
			return desc ? `${data.name}: ${desc}` : data.name;
		}

		// Nested format: data.message.content[] with type: "tool_use"
		const message = data.message as Record<string, unknown> | undefined;
		if (message && Array.isArray(message.content)) {
			const toolBlock = message.content.find((c: any) => c.type === 'tool_use');
			if (toolBlock?.name) {
				const desc = extractToolDescription(toolBlock);
				return desc ? `${toolBlock.name}: ${desc}` : toolBlock.name;
			}
		}

		return 'Tool';
	}

	function extractToolDescription(data: Record<string, unknown>): string | null {
		const input = data.input as Record<string, unknown> | undefined;
		if (!input) return null;

		// Common description fields
		if (typeof input.description === 'string') return input.description.slice(0, 100);
		if (typeof input.command === 'string') return input.command.slice(0, 100);
		if (typeof input.file_path === 'string') return input.file_path;
		if (typeof input.pattern === 'string') return input.pattern;
		if (typeof input.query === 'string') return input.query.slice(0, 100);

		return null;
	}

	function extractToolResult(data: Record<string, unknown>): string {
		let output: string | null = null;

		// Check for content field (nested or flat)
		if (typeof data.content === 'string' && data.content.length > 0) {
			output = data.content;
		}

		// Check for nested content array
		if (!output && Array.isArray(data.content)) {
			const textBlock = data.content.find((c: any) => c.type === 'text');
			if (textBlock?.text) output = textBlock.text as string;
		}

		if (output) {
			// Sanitize newlines and truncate
			const sanitized = output.replace(/\n+/g, ' ').trim();
			return `Output: ${sanitized.slice(0, 100)}`;
		}

		return 'Tool completed';
	}

	function extractSystemInfo(data: Record<string, unknown>): string {
		// Init event with model info
		if (typeof data.model === 'string') {
			return `Session started (${data.model})`;
		}

		// Check for subtype or message
		if (typeof data.subtype === 'string') {
			return data.subtype;
		}

		// Handle message field - can be string or object
		if (typeof data.message === 'string') {
			return data.message.slice(0, 100);
		}

		// Handle nested message object (same format as assistant events)
		const message = data.message as Record<string, unknown> | undefined;
		if (message && Array.isArray(message.content)) {
			const textBlock = message.content.find((c: any) => c.type === 'text');
			if (textBlock?.text) return (textBlock.text as string).slice(0, 100);
		}

		return 'System';
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
