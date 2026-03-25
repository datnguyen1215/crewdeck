<script lang="ts">
	import { page } from '$app/stores';
	import { getContext, tick } from 'svelte';
	import { listActiveRuns, listAgents, getProject, type ActiveRun, type Agent, type Project } from '$lib/api/http.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';

	// Track scroll containers and their "at bottom" state (reactive maps)
	let scrollContainers = $state<Map<string, HTMLElement>>(new Map());
	let atBottom = $state<Map<string, boolean>>(new Map());

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

	// Live updates via WebSocket
	$effect(() => {
		const ws = getWs();
		if (!ws) return;

		const handleRunStarted = (data: Record<string, unknown>) => {
			// Reload active runs when a new run starts
			listActiveRuns(projectId).then((r) => { runs = r; }).catch(() => {});
		};

		const handleRunEvent = (data: Record<string, unknown>) => {
			const runId = data.agent_run_id as string;
			if (!runId) return;
			const event = { id: crypto.randomUUID(), agent_run_id: runId, type: data.type as string, data: data.data, created_at: new Date().toISOString() };
			runs = runs.map((r) => {
				if (r.id !== runId) return r;
				return { ...r, events: [...r.events.slice(-49), event] };
			});
		};

		const handleRunCompleted = (data: Record<string, unknown>) => {
			const runId = data.agent_run_id as string;
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

	{#if loading}
		<div class="grid grid-cols-1 gap-4" style="grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));">
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
		</div>
	{:else if runs.length === 0}
		<!-- Empty state: show crew roster as idle -->
		<div class="text-center py-12">
			<div class="text-muted mb-6">
				<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto opacity-40">
					<rect x="2" y="3" width="20" height="14" rx="2"/>
					<line x1="8" y1="21" x2="16" y2="21"/>
					<line x1="12" y1="17" x2="12" y2="21"/>
				</svg>
			</div>
			<p class="text-muted text-sm mb-6">No agents are currently running</p>
			{#if agents.length > 0}
				<div class="grid grid-cols-1 gap-3 max-w-lg mx-auto" style="grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));">
					{#each agents.filter(a => a.id !== 'captain' && a.id !== 'librarian') as agent (agent.id)}
						<div class="bg-surface border border-edge rounded-lg px-4 py-3 text-left">
							<div class="flex items-center gap-2 mb-1">
								<span class="w-2 h-2 rounded-full bg-muted flex-shrink-0"></span>
								<span class="text-sm font-medium text-secondary">{agent.name}</span>
							</div>
							<p class="text-xs text-muted">{agent.title}</p>
							<span class="inline-block mt-2 text-[10px] uppercase tracking-wider text-muted border border-edge rounded px-1.5 py-0.5">Idle</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{:else}
		<!-- Active runs grid -->
		<div class="grid grid-cols-1 gap-4" style="grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));">
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
		</div>
	{/if}
</div>
