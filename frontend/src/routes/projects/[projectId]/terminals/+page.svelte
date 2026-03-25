<script lang="ts">
	import { page } from '$app/stores';
	import { getContext, tick, onMount } from 'svelte';
	import { listActiveRuns, listAgents, getProject, getMonitorHistory, type ActiveRun, type Agent, type Project, type ChatMessage } from '$lib/api/http.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import type { WsEventMap } from '$lib/api/types.js';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';
	import { md } from '$lib/utils/markdown.js';

	// Monitor entry type for captain feed
	interface MonitorEntry {
		id: string;
		type: 'event' | 'thinking' | 'message' | 'tool_call' | 'tool_result';
		content: string;
		timestamp: Date;
		toolName?: string;
		toolInput?: unknown;
		success?: boolean;
	}

	// Track scroll containers and their "at bottom" state (reactive maps)
	let scrollContainers = $state<Map<string, HTMLElement>>(new Map());
	let atBottom = $state<Map<string, boolean>>(new Map());

	// Captain monitor state
	let monitorEntries = $state<MonitorEntry[]>([]);
	let monitorLoading = $state(true);
	let monitorContainer: HTMLDivElement | undefined;
	let monitorAtBottom = $state(true);
	let isAnalyzing = $state(false);

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

	let projectId = $derived($page.params.projectId!);
	let project = $state<Project | null>(null);
	let runs = $state<ActiveRun[]>([]);
	let agents = $state<Agent[]>([]);
	let loading = $state(true);

	// Load active runs and project info
	$effect(() => {
		loading = true;
		let cancelled = false;
		Promise.all([listActiveRuns(projectId), getProject(projectId), listAgents()])
			.then(([r, p, a]) => {
				if (cancelled) return;
				runs = r;
				project = p;
				agents = a;
			})
			.catch(() => {})
			.finally(() => { if (!cancelled) loading = false; });
		return () => { cancelled = true; };
	});

	// Convert stored ChatMessage to MonitorEntry
	function mapMessageToEntry(msg: ChatMessage): MonitorEntry {
		return {
			id: msg.id,
			type: msg.role === 'user' ? 'event' : 'message',
			content: msg.content,
			timestamp: new Date(msg.created_at),
		};
	}

	// Load monitor history on mount
	onMount(async () => {
		try {
			const history = await getMonitorHistory(projectId);
			monitorEntries = history.map(mapMessageToEntry);
			scrollMonitorToBottom();
		} catch (err) {
			console.error('Failed to load monitor history:', err);
		} finally {
			monitorLoading = false;
		}
	});

	// Subscribe to monitor WebSocket events
	$effect(() => {
		const ws = getWs();
		if (!ws || monitorLoading) return;

		const handleEventReceived = (data: WsEventMap['monitor.event_received']) => {
			monitorEntries = [...monitorEntries, {
				id: crypto.randomUUID(),
				type: 'event',
				content: `${data.event_type} - ${data.description ?? ''}`,
				timestamp: new Date(),
			}];
			scrollMonitorToBottom();
		};

		const handleThinking = () => {
			isAnalyzing = true;
			monitorEntries = [...monitorEntries, {
				id: crypto.randomUUID(),
				type: 'thinking',
				content: 'Analyzing...',
				timestamp: new Date(),
			}];
			scrollMonitorToBottom();
		};

		const handleMessage = (data: WsEventMap['monitor.message']) => {
			monitorEntries = [...monitorEntries, {
				id: crypto.randomUUID(),
				type: 'message',
				content: data.content,
				timestamp: new Date(),
			}];
			scrollMonitorToBottom();
		};

		const handleToolCall = (data: WsEventMap['monitor.tool_call']) => {
			monitorEntries = [...monitorEntries, {
				id: crypto.randomUUID(),
				type: 'tool_call',
				content: `${data.tool_name}`,
				toolName: data.tool_name,
				toolInput: data.tool_input,
				timestamp: new Date(),
			}];
			scrollMonitorToBottom();
		};

		const handleToolResult = (data: WsEventMap['monitor.tool_result']) => {
			const result = data.result as { success: boolean; message: string } | undefined;
			monitorEntries = [...monitorEntries, {
				id: crypto.randomUUID(),
				type: 'tool_result',
				content: result?.message ?? '',
				toolName: data.tool_name,
				success: result?.success ?? true,
				timestamp: new Date(),
			}];
			scrollMonitorToBottom();
		};

		const handleComplete = () => {
			isAnalyzing = false;
			monitorEntries = monitorEntries.filter(e => e.type !== 'thinking');
		};

		const unsubs = [
			ws.on('monitor.event_received', handleEventReceived),
			ws.on('monitor.thinking', handleThinking),
			ws.on('monitor.message', handleMessage),
			ws.on('monitor.tool_call', handleToolCall),
			ws.on('monitor.tool_result', handleToolResult),
			ws.on('monitor.complete', handleComplete),
		];

		return () => unsubs.forEach((fn) => fn());
	});

	async function scrollMonitorToBottom() {
		await tick();
		if (monitorContainer && monitorAtBottom) {
			monitorContainer.scrollTop = monitorContainer.scrollHeight;
		}
	}

	function handleMonitorScroll(e: Event) {
		const el = e.target as HTMLElement;
		monitorAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
	}

	function formatMonitorTime(date: Date): string {
		return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}

	function formatToolInput(input: unknown): string {
		if (!input) return '';
		if (typeof input === 'object') {
			return Object.entries(input as Record<string, unknown>)
				.map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
				.join(', ');
		}
		return String(input);
	}

	function monitorTypeLabel(type: MonitorEntry['type']): string {
		switch (type) {
			case 'event': return 'event';
			case 'thinking': return 'monitor';
			case 'message': return 'monitor';
			case 'tool_call': return 'tool';
			case 'tool_result': return 'tool';
		}
	}

	function monitorTypeColor(type: MonitorEntry['type']): string {
		switch (type) {
			case 'event': return 'text-yellow/80';
			case 'thinking': return 'text-cyan';
			case 'message': return 'text-cyan';
			case 'tool_call': return 'text-purple';
			case 'tool_result': return 'text-purple';
		}
	}

	// Live updates via WebSocket
	$effect(() => {
		const ws = getWs();
		if (!ws) return;

		const handleRunStarted = () => {
			listActiveRuns(projectId).then((r) => { runs = r; }).catch(() => {});
		};

		const handleRunEvent = (data: WsEventMap['run.event']) => {
			const runId = data.agent_run_id;
			if (!runId) return;
			const event = { id: crypto.randomUUID(), agent_run_id: runId, type: data.type, data: data.data, created_at: new Date().toISOString() };
			runs = runs.map((r) => {
				if (r.id !== runId) return r;
				return { ...r, events: [...r.events.slice(-49), event] };
			});
		};

		const handleRunCompleted = (data: WsEventMap['run.completed']) => {
			const runId = data.agent_run_id;
			runs = runs.filter((r) => r.id !== runId);
		};

		const unsubs = [
			ws.on('run.started', handleRunStarted),
			ws.on('run.event', handleRunEvent),
			ws.on('run.completed', handleRunCompleted),
			// Also reload on mention events which may spawn runs
			ws.on('mention.spawned', handleRunStarted),
			ws.on('mention.completed', () => {
				listActiveRuns(projectId).then((r) => { runs = r; }).catch(() => {});
			}),
			ws.on('dispatch.dequeued', handleRunStarted),
		];
		return () => unsubs.forEach((u) => u());
	});

	interface FormattedEvent {
		label: string;
		content: string | null;
	}

	function formatToolUse(tool: { name: string; input: unknown }): FormattedEvent {
		const input = tool.input as Record<string, unknown> | undefined;
		switch (tool.name) {
			case 'Read':
				return { label: 'Read', content: (input?.file_path as string) ?? null };
			case 'Edit':
				return { label: 'Edit', content: (input?.file_path as string) ?? null };
			case 'Write':
				return { label: 'Write', content: (input?.file_path as string) ?? null };
			case 'Bash':
				return { label: 'Bash', content: (input?.command as string) ?? (input?.description as string) ?? null };
			case 'Glob':
				return { label: 'Glob', content: (input?.pattern as string) ?? null };
			case 'Grep':
				return { label: 'Grep', content: (input?.pattern as string) ?? null };
			case 'Task':
				return { label: 'Task', content: (input?.description as string) ?? (input?.prompt as string) ?? null };
			case 'TodoWrite':
				return { label: 'TodoWrite', content: null };
			default:
				return { label: tool.name || 'Tool', content: input ? JSON.stringify(input).slice(0, 200) : null };
		}
	}

	function formatEvent(event: { type: string; data: unknown }): FormattedEvent {
		const d = event.data as Record<string, unknown> | null;
		switch (event.type) {
			case 'assistant': {
				// Normalized: d.text, d.tool_use[]
				if (d?.text) return { label: 'Assistant', content: d.text as string };
				if (Array.isArray(d?.tool_use) && d.tool_use.length > 0) {
					return formatToolUse(d.tool_use[0] as { name: string; input: unknown });
				}
				return { label: 'Assistant', content: null };
			}
			case 'user': {
				// Normalized: d.tool_results[]
				if (Array.isArray(d?.tool_results) && d.tool_results.length > 0) {
					const result = d.tool_results[0] as { output: string };
					return { label: 'Result', content: result.output || null };
				}
				return { label: 'User', content: null };
			}
			case 'tool_use': {
				// Normalized: d.tool_use[]
				if (Array.isArray(d?.tool_use) && d.tool_use.length > 0) {
					return formatToolUse(d.tool_use[0] as { name: string; input: unknown });
				}
				return { label: 'Tool', content: null };
			}
			case 'tool_result': {
				// Normalized: d.tool_results[]
				if (Array.isArray(d?.tool_results) && d.tool_results.length > 0) {
					const result = d.tool_results[0] as { output: string };
					return { label: 'Result', content: result.output || null };
				}
				return { label: 'Result', content: null };
			}
			case 'system': {
				// Normalized: d.model, d.subtype, d.message
				if (d?.model) return { label: 'System', content: `Session started (${d.model})` };
				if (d?.subtype) return { label: 'System', content: d.subtype as string };
				if (d?.message) return { label: 'System', content: d.message as string };
				return { label: 'System', content: null };
			}
			case 'result':
				return { label: 'Finished', content: (d?.result as string) ?? null };
			case 'error':
				return { label: 'Error', content: (d?.error as string) ?? 'unknown' };
			default:
				return { label: event.type, content: d ? JSON.stringify(d).slice(0, 200) : null };
		}
	}

	function handleScroll(runId: string, e: Event) {
		const el = e.target as HTMLElement;
		const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
		atBottom = new Map(atBottom).set(runId, isAtBottom);
	}

	function scrollContainer(el: HTMLElement, runId: string) {
		scrollContainers = new Map(scrollContainers).set(runId, el);
		// Default to being at bottom for new containers
		if (!atBottom.has(runId)) {
			atBottom = new Map(atBottom).set(runId, true);
		}
		return {
			destroy() {
				const newContainers = new Map(scrollContainers);
				newContainers.delete(runId);
				scrollContainers = newContainers;
				const newAtBottom = new Map(atBottom);
				newAtBottom.delete(runId);
				atBottom = newAtBottom;
			}
		};
	}

	// Derive total event count to ensure reactive dependency on event changes
	let totalEventCount = $derived(runs.reduce((sum, r) => sum + r.events.length, 0));

	// Auto-scroll when events change
	$effect(() => {
		// Access derived value to establish dependency
		void totalEventCount;
		// Scroll after DOM updates
		tick().then(() => {
			for (const run of runs) {
				const container = scrollContainers.get(run.id);
				const shouldScroll = atBottom.get(run.id) ?? true;
				if (container && shouldScroll) {
					container.scrollTop = container.scrollHeight;
				}
			}
		});
	});

	function formatElapsed(startedAt: string | null): string {
		if (!startedAt) return '0s';
		const ms = Date.now() - new Date(startedAt).getTime();
		const secs = Math.floor(ms / 1000);
		if (secs < 60) return `${secs}s`;
		const mins = Math.floor(secs / 60);
		const remainSecs = secs % 60;
		if (mins < 60) return `${mins}m ${remainSecs}s`;
		const hrs = Math.floor(mins / 60);
		return `${hrs}h ${mins % 60}m`;
	}

	function formatCost(cost: number | null): string {
		if (cost === null || cost === undefined) return '$0.00';
		return `$${cost.toFixed(2)}`;
	}

	function statusColor(status: string): string {
		switch (status) {
			case 'running': return 'text-green bg-green/10 border-green/30';
			case 'queued': return 'text-amber bg-amber/10 border-amber/30';
			default: return 'text-muted bg-surface border-edge';
		}
	}

	// Tick elapsed time every second
	let elapsedTick = $state(0);
	$effect(() => {
		if (runs.length === 0) return;
		const interval = setInterval(() => { elapsedTick++; }, 1000);
		return () => clearInterval(interval);
	});
</script>

<svelte:head>
	<title>{project?.name ? `Terminals - ${project.name} - CrewDeck` : 'Terminals - CrewDeck'}</title>
</svelte:head>

<div class="p-4 md:p-6 h-full overflow-auto pt-14 md:pt-6">
	<div class="mb-4 md:mb-5">
		<Breadcrumb segments={[
			{ label: 'Projects', href: '/' },
			{ label: project?.name ?? 'Project', href: `/projects/${projectId}` },
			{ label: 'Terminals' }
		]} />
	</div>

	<div class="flex items-center justify-between mb-5">
		<div>
			<h1 class="text-lg md:text-xl font-bold text-primary uppercase tracking-wide">Terminals</h1>
			<p class="text-muted text-xs mt-0.5">
				{#if loading}
					Loading...
				{:else}
					{runs.length} active agent{runs.length !== 1 ? 's' : ''}
				{/if}
			</p>
		</div>
	</div>

	<!-- Terminals grid: always show captain monitor card + agent runs -->
	<div class="grid grid-cols-1 gap-4" style="grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));">
		<!-- Captain Monitor Card -->
		<div class="bg-surface border border-cyan/30 rounded-lg overflow-hidden flex flex-col fade-up">
			<!-- Header -->
			<div class="px-4 py-3 border-b border-cyan/30 bg-cyan/5">
				<div class="flex items-center gap-2 mb-1">
					<span class="text-sm font-medium text-cyan">Captain</span>
					<span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border {isAnalyzing ? 'text-cyan bg-cyan/10 border-cyan/30' : 'text-muted bg-surface border-edge'}">
						{isAnalyzing ? 'Analyzing' : 'Monitoring'}
					</span>
					{#if isAnalyzing}
						<span class="w-1.5 h-1.5 rounded-full bg-cyan animate-pulse"></span>
					{/if}
				</div>
				<p class="text-xs text-muted">Project orchestration feed</p>
			</div>

			<!-- Monitor feed -->
			<div
				bind:this={monitorContainer}
				onscroll={handleMonitorScroll}
				class="flex-1 min-h-[200px] max-h-[300px] overflow-y-auto p-3 font-mono text-xs bg-black/20"
			>
				{#if monitorLoading}
					<div class="text-muted py-8 text-center">
						<p class="animate-pulse">Loading monitor history...</p>
					</div>
				{:else if monitorEntries.length === 0}
					<div class="text-muted py-8 text-center">
						<p class="mb-2">Monitor feed empty.</p>
						<p class="text-xs">Orchestration events will appear here.</p>
					</div>
				{:else}
					<div class="space-y-2">
						{#each monitorEntries.slice(-50) as entry (entry.id)}
							<div class="flex gap-2 min-w-0">
								<span class="text-muted/50 flex-shrink-0">[{formatMonitorTime(entry.timestamp)}]</span>
								<span class="{monitorTypeColor(entry.type)} flex-shrink-0">[{monitorTypeLabel(entry.type)}]</span>
								{#if entry.type === 'event'}
									<span class="text-muted break-words min-w-0">{entry.content}</span>
								{:else if entry.type === 'thinking'}
									<span class="text-muted animate-pulse min-w-0">{entry.content}</span>
								{:else if entry.type === 'message'}
									<span class="text-primary prose prose-sm prose-invert max-w-none inline break-words min-w-0">
										{@html md(entry.content)}
									</span>
								{:else if entry.type === 'tool_call'}
									<span class="text-purple break-words min-w-0">
										<span class="text-muted/50">-></span> {entry.toolName}({formatToolInput(entry.toolInput)})
									</span>
								{:else if entry.type === 'tool_result'}
									<span class="text-muted/50 flex-shrink-0">-></span>
									<span class="{entry.success ? 'text-green' : 'text-red'} min-w-0">
										{entry.success ? 'ok' : 'err'}:
									</span>
									<span class="text-muted break-words min-w-0">{entry.content}</span>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="px-4 py-2 border-t border-cyan/30 flex items-center justify-between text-xs text-muted bg-cyan/5">
				<span class="font-mono">Read-only feed</span>
				<a href="/projects/{projectId}/chat" class="text-cyan hover:text-cyan/80 transition-colors">Open chat →</a>
			</div>
		</div>

		{#if loading}
			<!-- Loading skeletons for agent runs -->
			{#each Array(2) as _, i}
				<div class="bg-surface border border-edge rounded-lg overflow-hidden fade-up" style="animation-delay: {i * 60}ms">
					<div class="px-4 py-3 border-b border-edge">
						<div class="skeleton h-4 w-32 rounded mb-2"></div>
						<div class="skeleton h-3 w-48 rounded"></div>
					</div>
					<div class="p-4 space-y-2">
						{#each Array(4) as _}
							<div class="skeleton h-3 rounded" style="width: {50 + Math.random() * 40}%"></div>
						{/each}
					</div>
					<div class="px-4 py-2 border-t border-edge">
						<div class="skeleton h-3 w-24 rounded"></div>
					</div>
				</div>
			{/each}
		{:else}
			<!-- Agent run cards -->
			{#each runs as run (run.id)}
				{@const isRunning = run.status === 'running'}
				<div class="bg-surface border border-edge rounded-lg overflow-hidden flex flex-col fade-up">
					<!-- Header -->
					<div class="px-4 py-3 border-b border-edge bg-base-hi">
						<div class="flex items-center gap-2 mb-1">
							<span class="text-sm font-medium text-primary">{run.agent_name}</span>
							<span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border {statusColor(run.status)}">
								{run.status}
							</span>
							{#if isRunning}
								<span class="w-1.5 h-1.5 rounded-full bg-green animate-pulse"></span>
							{/if}
						</div>
						{#if run.issue_title}
							<a
								href="/projects/{projectId}/issues/{run.issue_id}"
								class="text-xs text-muted hover:text-cyan transition-colors truncate block"
								title={run.issue_title}
							>
								{run.issue_title}
							</a>
						{/if}
					</div>

					<!-- Live feed -->
					<div
						class="flex-1 min-h-[200px] max-h-[300px] overflow-y-auto p-3 font-mono text-xs space-y-2 bg-base"
						use:scrollContainer={run.id}
						onscroll={(e) => handleScroll(run.id, e)}
					>
						{#if run.events.length === 0}
							<div class="text-muted italic py-8 text-center">
								{run.status === 'queued' ? 'Waiting in queue...' : 'Waiting for events...'}
							</div>
						{:else}
							{#each run.events.slice(-30) as event (event.id)}
								{@const formatted = formatEvent(event)}
								<div class="py-1 border-b border-edge/30 last:border-0">
									<div class="flex gap-2 text-secondary">
										<span class="text-muted flex-shrink-0 select-none">{new Date(event.created_at).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
										<span class="text-cyan font-medium">{formatted.label}</span>
									</div>
									{#if formatted.content}
										<pre class="mt-1 ml-[72px] text-secondary whitespace-pre-wrap break-words max-h-32 overflow-y-auto">{formatted.content}</pre>
									{/if}
								</div>
							{/each}
						{/if}
					</div>

					<!-- Footer -->
					<div class="px-4 py-2 border-t border-edge flex items-center justify-between text-xs text-muted bg-base-hi">
						<span>{#key elapsedTick}{formatElapsed(run.started_at)}{/key}</span>
						<span>{formatCost(run.cost_usd)}</span>
					</div>
				</div>
			{/each}

			<!-- Show idle agents when no runs -->
			{#if runs.length === 0 && agents.length > 0}
				{#each agents.filter(a => a.id !== 'captain' && a.id !== 'librarian') as agent (agent.id)}
					<div class="bg-surface border border-edge rounded-lg px-4 py-3 text-left fade-up">
						<div class="flex items-center gap-2 mb-1">
							<span class="w-2 h-2 rounded-full bg-muted flex-shrink-0"></span>
							<span class="text-sm font-medium text-secondary">{agent.name}</span>
						</div>
						<p class="text-xs text-muted">{agent.title}</p>
						<span class="inline-block mt-2 text-[10px] uppercase tracking-wider text-muted border border-edge rounded px-1.5 py-0.5">Idle</span>
					</div>
				{/each}
			{/if}
		{/if}
	</div>
</div>
