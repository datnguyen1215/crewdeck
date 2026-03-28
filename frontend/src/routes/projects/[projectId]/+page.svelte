<script lang="ts">
	import { page } from '$app/stores';
	import { getContext } from 'svelte';
	import { listIssues, createIssue, dispatchAgent, getProject, type IssueWithRunningAgent, type Agent, type Project } from '$lib/api/http.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import Modal from '$lib/components/Modal.svelte';
	import QueueMonitor from '$lib/components/QueueMonitor.svelte';
	import ActivityTerminal from '$lib/components/ActivityTerminal.svelte';
	import { STATUS_CFG } from '$lib/config/status.js';
	import { parseUTC, relTimeDiff } from '$lib/utils/time.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import { createFormState } from '$lib/utils/form.svelte.js';
	import { fetchEffect } from '$lib/utils/fetch-effect.svelte.js';

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');
	const getAgents = getContext<() => Agent[]>('agents');

	let issues = $state<IssueWithRunningAgent[]>([]);
	let agents = $derived(getAgents());
	let project = $state<Project | null>(null);
	let loading = $state(true);

	let projectId = $derived($page.params.projectId!);
	let pageTitle = $derived(project?.name ? `${project.name} - CrewDeck` : 'CrewDeck');

	// Filter state
	let filterStatuses = $state<string[]>([]);
	let filterAgent = $state('');
	let showCompleted = $state(false);
	let searchQuery = $state('');

	// Sort state — newest first by default
	let sortField = $state<'created_at' | 'updated_at'>('created_at');
	let sortDesc = $state(true);

	// Modal state
	const form = createFormState({ title: '', description: '' });

	fetchEffect(
		() => Promise.all([listIssues(projectId), getProject(projectId)]),
		{
			onData: ([i, p]) => { issues = i; project = p; },
			onError: 'Failed to load issues',
			onLoading: (v) => { loading = v; },
		}
	);

	$effect(() => {
		const ws = getWs();
		if (!ws) return;
		const reload = () => {
			listIssues(projectId)
				.then((i) => { issues = i; })
				.catch(() => toastStore.add('Failed to refresh issues', 'error'));
		};
		const unsubs = [
			ws.on('issue.created', reload),
			ws.on('issue.updated', reload),
			ws.on('issue.status_changed', reload),
			ws.on('issue.paused', reload),
			ws.on('issue.resumed', reload),
			ws.on('mention.completed', reload),
			ws.on('run.started', reload),
			ws.on('run.completed', reload),
		];
		return () => unsubs.forEach(fn => fn());
	});

	let agentMap = $derived(Object.fromEntries(agents.map((a) => [a.id, a.name])));

	let filtered = $derived.by(() => {
		let result = [...issues];
		// Text search filter
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter((i) =>
				i.title.toLowerCase().includes(q) ||
				(i.description && i.description.toLowerCase().includes(q))
			);
		}
		// Hide done issues unless showCompleted is enabled
		if (!showCompleted && !filterStatuses.includes('done')) {
			result = result.filter((i) => i.status !== 'done');
		}
		if (filterStatuses.length > 0) {
			result = result.filter((i) => filterStatuses.includes(i.status));
		}
		// Filter by agent
		if (filterAgent === '__unassigned__') {
			result = result.filter((i) => !i.agent_id);
		} else if (filterAgent) {
			result = result.filter((i) => i.agent_id === filterAgent);
		}
		result.sort((a, b) => {
			const av = a[sortField];
			const bv = b[sortField];
			const cmp = av > bv ? 1 : av < bv ? -1 : 0;
			return sortDesc ? -cmp : cmp;
		});
		return result;
	});

	function toggleStatus(status: string) {
		filterStatuses = filterStatuses.includes(status)
			? filterStatuses.filter((s) => s !== status)
			: [...filterStatuses, status];
	}


	// Track dispatching state per issue
	let dispatchingIssues = $state<Set<string>>(new Set());

	function hasActiveAgent(issue: IssueWithRunningAgent): boolean {
		return issue.running_agent_status === 'running' || issue.running_agent_status === 'queued';
	}

	async function handleDispatch(e: Event, issue: IssueWithRunningAgent) {
		e.preventDefault();
		e.stopPropagation();
		if (hasActiveAgent(issue) || dispatchingIssues.has(issue.id)) return;

		dispatchingIssues = new Set([...dispatchingIssues, issue.id]);
		try {
			await dispatchAgent(projectId, issue.id, 'engineer');
			toastStore.add('Engineer dispatched to work on issue', 'success');
		} catch (err) {
			toastStore.add('Failed to dispatch agent', 'error');
		} finally {
			dispatchingIssues = new Set([...dispatchingIssues].filter(id => id !== issue.id));
		}
	}

	async function handleCreate(e: SubmitEvent) {
		e.preventDefault();
		if (!form.fields.title.trim() || !form.fields.description.trim()) return;
		await form.submit(async (f) => {
			const issue = await createIssue(projectId, {
				title: f.title.trim(),
				description: f.description.trim()
			});
			issues = [...issues, { ...issue, running_agent_id: null, running_agent_status: null }];
		});
	}

</script>

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

<div class="h-full flex flex-col pt-14 md:pt-6">
	<div class="flex-1 overflow-auto p-4 md:p-6 min-h-0">
	<!-- Header -->
	<div class="flex items-center justify-between mb-5 gap-3">
		<div class="min-w-0">
			<h1 class="text-lg md:text-xl font-bold text-primary uppercase tracking-wide">Issues</h1>
			<p class="text-muted text-xs mt-0.5">
				{#if !loading}{filtered.length} of {issues.length} issues{:else}Loading…{/if}
			</p>
		</div>
		<button
			onclick={() => form.show()}
			class="px-3 py-2 md:py-1.5 bg-surface border border-edge text-primary text-xs font-medium rounded hover:border-edge-hi hover:bg-surface-hi transition-colors uppercase tracking-wide flex-shrink-0 min-h-[44px] md:min-h-0"
		>
			+ New Issue
		</button>
	</div>

	<!-- Filters -->
	<div class="mb-5 space-y-3">
		<!-- Search input -->
		<div class="flex flex-col sm:flex-row sm:items-center gap-2">
			<span class="text-xs text-muted uppercase tracking-widest hidden sm:inline">Search:</span>
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Filter by title or description…"
				class="flex-1 w-full sm:max-w-sm bg-surface border border-edge text-secondary text-xs rounded px-3 py-2.5 sm:py-1.5 hover:border-edge-hi focus:border-cyan transition-colors outline-none placeholder:text-muted"
			/>
			{#if searchQuery}
				<button
					onclick={() => (searchQuery = '')}
					class="px-3 py-1.5 text-xs text-muted hover:text-secondary border border-edge hover:border-edge-hi rounded transition-colors self-start"
				>
					Clear ×
				</button>
			{/if}
		</div>

		<!-- Status toggle pills -->
		<div class="flex flex-wrap items-center gap-1.5">
			<span class="text-xs text-muted uppercase tracking-widest mr-1 w-full sm:w-auto mb-1 sm:mb-0">Status:</span>
			{#each Object.entries(STATUS_CFG) as [key, cfg] (key)}
				<button
					onclick={() => toggleStatus(key)}
					class="px-2.5 py-1.5 sm:py-0.5 text-xs rounded border transition-colors min-h-[36px] sm:min-h-0 {filterStatuses.includes(key)
						? `${cfg.text} ${cfg.border} bg-surface-hi`
						: 'text-muted border-edge hover:border-edge-hi hover:text-secondary'}"
				>
					{cfg.label}
				</button>
			{/each}
			{#if filterStatuses.length > 0}
				<button
					onclick={() => (filterStatuses = [])}
					class="px-2.5 py-1.5 sm:py-0.5 text-xs text-muted hover:text-secondary border border-transparent hover:border-edge rounded transition-colors"
				>
					Clear ×
				</button>
			{/if}
		</div>

		<!-- Agent + Sort controls -->
		<div class="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 flex-wrap">
			<div class="flex items-center gap-2">
				<span class="text-xs text-muted uppercase tracking-widest">Agent:</span>
				<select
					bind:value={filterAgent}
					class="bg-surface border border-edge text-secondary text-xs rounded px-2 py-2 sm:py-1 hover:border-edge-hi transition-colors cursor-pointer outline-none min-h-[36px] sm:min-h-0"
				>
					<option value="">All</option>
					<option value="__unassigned__">Unassigned</option>
					{#each agents as agent (agent.id)}
						<option value={agent.id}>{agent.name}</option>
					{/each}
				</select>
			</div>

			<div class="flex items-center gap-2">
				<span class="text-xs text-muted uppercase tracking-widest">Sort:</span>
				<select
					bind:value={sortField}
					class="bg-surface border border-edge text-secondary text-xs rounded px-2 py-2 sm:py-1 hover:border-edge-hi transition-colors cursor-pointer outline-none min-h-[36px] sm:min-h-0"
				>
					<option value="created_at">Created</option>
					<option value="updated_at">Updated</option>
				</select>
				<button
					onclick={() => (sortDesc = !sortDesc)}
					class="px-3 py-2 sm:py-1 bg-surface border border-edge text-secondary text-xs rounded hover:border-edge-hi hover:text-primary transition-colors min-h-[36px] sm:min-h-0"
					title={sortDesc ? 'Descending' : 'Ascending'}
				>
					{sortDesc ? '↓ Desc' : '↑ Asc'}
				</button>
			</div>

			<label class="flex items-center gap-2 cursor-pointer min-h-[36px] sm:min-h-0">
				<input
					type="checkbox"
					bind:checked={showCompleted}
					class="accent-cyan w-4 h-4"
				/>
				<span class="text-xs text-muted">Show completed</span>
			</label>

			<div class="sm:ml-auto">
				<QueueMonitor />
			</div>
		</div>
	</div>

	<!-- Table / Empty state -->
	{#if loading}
		<!-- Mobile skeleton cards -->
		<div class="flex flex-col gap-3 md:hidden fade-up">
			{#each Array(5) as _, i}
				<div class="bg-surface border border-edge rounded-lg p-4 fade-up" style="animation-delay: {i * 30}ms">
					<div class="skeleton h-5 w-3/4 rounded mb-3"></div>
					<div class="flex items-center gap-3">
						<div class="skeleton h-6 w-20 rounded"></div>
						<div class="skeleton h-4 w-12 rounded"></div>
					</div>
				</div>
			{/each}
		</div>
		<!-- Desktop skeleton table -->
		<div class="overflow-x-auto fade-up hidden md:block">
			<div class="min-w-[560px] border border-edge rounded overflow-hidden">
				<div class="grid grid-cols-[1fr_148px_96px_60px_44px] text-xs text-muted uppercase tracking-widest bg-base-hi border-b border-edge">
					<div class="px-3 py-2.5">Title</div>
					<div class="px-3 py-2.5">Status</div>
					<div class="px-3 py-2.5">Agent</div>
					<div class="px-3 py-2.5 text-right">Age</div>
					<div class="px-2 py-2.5"></div>
				</div>
				{#each Array(8) as _, i}
					{@const skeletonWidths = [75, 60, 90, 55, 80, 65, 70, 85]}
					<div
						class="grid grid-cols-[1fr_148px_96px_60px_44px] border-b border-edge last:border-0 fade-up {i % 2 === 1 ? 'bg-base-hi' : 'bg-base'}"
					style="animation-delay: {i * 30}ms"
					>
						<div class="px-3 py-3 flex items-center gap-2">
							<div class="skeleton h-4 rounded" style="width: {skeletonWidths[i]}%"></div>
						</div>
						<div class="px-3 py-3 flex items-center">
							<div class="skeleton h-5 w-24 rounded"></div>
						</div>
						<div class="px-3 py-3 flex items-center">
							<div class="skeleton h-4 w-16 rounded"></div>
						</div>
						<div class="px-3 py-3 flex items-center justify-end">
							<div class="skeleton h-3 w-8 rounded"></div>
						</div>
						<div class="px-2 py-3"></div>
					</div>
				{/each}
			</div>
		</div>
	{:else if issues.length === 0}
			<div class="flex flex-col items-center justify-center py-16 md:py-24 text-center px-4">
				<p class="text-primary text-lg font-semibold mb-1">No issues yet</p>
				<p class="text-muted text-sm mb-6">Create your first issue to get started</p>
				<button
					onclick={() => form.show()}
					class="px-4 py-3 md:py-2 bg-surface border border-edge text-primary text-sm rounded hover:border-edge-hi hover:bg-surface-hi transition-colors uppercase tracking-wide min-h-[44px]"
				>
					+ Create Issue
				</button>
			</div>
	{:else if filtered.length === 0}
		<div class="py-16 text-center">
			<p class="text-muted text-sm">No issues match the current filters.</p>
		</div>
	{:else}
		<!-- Mobile card view -->
		<div class="flex flex-col gap-3 md:hidden">
			{#each filtered as issue, i (issue.id)}
				{@const cfg = STATUS_CFG[issue.status] ?? STATUS_CFG.open}
				{@const runningAgentName = issue.running_agent_id ? agentMap[issue.running_agent_id] : null}
				{@const isQueued = issue.running_agent_status === 'queued'}
				{@const isDispatching = dispatchingIssues.has(issue.id)}
				{@const canDispatch = !hasActiveAgent(issue) && !isDispatching}
				<a
					href="/projects/{projectId}/issues/{issue.id}"
					class="block bg-surface border border-edge rounded-lg p-4 hover:bg-surface-hi hover:border-edge-hi transition-colors active:scale-[0.99] {issue.status === 'in_progress' ? 'border-l-green border-l-2' : ''} {issue.paused ? 'opacity-60' : ''}"
					style="animation: fade-up 0.25s ease both; animation-delay: {i * 25}ms"
				>
					<div class="flex items-start justify-between gap-3 mb-3">
						<p class="text-primary text-sm font-medium leading-snug flex-1 min-w-0 flex items-center gap-2">
							{#if issue.paused}
								<span class="text-amber" title="Paused">⏸️</span>
							{/if}
							{issue.title}
						</p>
						<button
							onclick={(e) => handleDispatch(e, issue)}
							disabled={!canDispatch}
							class="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg border transition-colors {canDispatch ? 'border-edge text-muted hover:border-cyan hover:text-cyan hover:bg-cyan/10 active:bg-cyan/20' : 'border-transparent text-muted/40 cursor-not-allowed'}"
							title={hasActiveAgent(issue) ? 'Agent already running' : 'Start work'}
						>
							{#if isDispatching}
								<svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
									<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="32" stroke-dashoffset="12" />
								</svg>
							{:else}
								<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
									<path d="M8 5v14l11-7z"/>
								</svg>
							{/if}
						</button>
					</div>
					<div class="flex items-center gap-3 flex-wrap">
						<span
							class="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border {cfg.text} {cfg.border} {cfg.pulse ? 'badge-pulse' : ''}"
							style={cfg.glow ? `box-shadow: ${cfg.glow}` : ''}
						>
							<span class="leading-none">{cfg.dot}</span>
							{cfg.label}
						</span>
						{#if runningAgentName}
							<span class="text-xs {isQueued ? 'text-muted' : 'text-cyan'}">
								{runningAgentName}
							</span>
						{/if}
						<span class="text-xs text-muted font-mono ml-auto" title={parseUTC(issue.created_at).toLocaleString()}>
							{relTimeDiff(issue.created_at)}
						</span>
					</div>
					{#if issue.created_by === 'agent'}
						<p class="text-muted text-xs mt-2">proposed by agent</p>
					{/if}
				</a>
			{/each}
		</div>

		<!-- Desktop table view -->
		<div class="overflow-x-auto hidden md:block">
				<div class="min-w-[560px] border border-edge rounded overflow-hidden">
					<!-- Table header -->
					<div
						class="grid grid-cols-[1fr_148px_96px_60px_44px] text-xs text-muted uppercase tracking-widest bg-base-hi border-b border-edge"
					>
						<div class="px-3 py-2.5">Title</div>
						<div class="px-3 py-2.5">Status</div>
						<div class="px-3 py-2.5">Agent</div>
						<div class="px-3 py-2.5 text-right">Age</div>
						<div class="px-2 py-2.5"></div>
					</div>

					<!-- Rows -->
					{#each filtered as issue, i (issue.id)}
						{@const cfg = STATUS_CFG[issue.status] ?? STATUS_CFG.open}
						{@const runningAgentName = issue.running_agent_id ? agentMap[issue.running_agent_id] : null}
						{@const isQueued = issue.running_agent_status === 'queued'}
						{@const isDispatching = dispatchingIssues.has(issue.id)}
						{@const canDispatch = !hasActiveAgent(issue) && !isDispatching}
						<a
							href="/projects/{projectId}/issues/{issue.id}"
							class="issue-row grid grid-cols-[1fr_148px_96px_60px_44px] border-b border-edge last:border-0 hover:bg-surface-hi transition-colors group {i % 2 === 1 ? 'bg-base-hi' : 'bg-base'} {issue.status === 'in_progress' ? 'in-progress-row' : ''} {issue.paused ? 'opacity-60' : ''}"
							style="animation: fade-up 0.25s ease both; animation-delay: {i * 25}ms"
						>
							<!-- Title -->
							<div class="px-3 py-3 self-center min-w-0">
								<p class="text-primary text-sm truncate group-hover:text-cyan transition-colors flex items-center gap-2">
									{#if issue.paused}
										<span class="text-amber flex-shrink-0" title="Paused">⏸️</span>
									{/if}
									{issue.title}
								</p>
								{#if issue.created_by === 'agent'}
									<p class="text-muted text-xs mt-0.5">proposed by agent</p>
								{/if}
							</div>

							<!-- Status badge -->
							<div class="px-3 py-3 self-center">
								<span
									class="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border {cfg.text} {cfg.border} {cfg.pulse ? 'badge-pulse' : ''}"
									style={cfg.glow ? `box-shadow: ${cfg.glow}` : ''}
								>
									<span class="leading-none">{cfg.dot}</span>
									{cfg.label}
								</span>
							</div>

							<!-- Agent (shows running/queued agent if active, else "—") -->
							<div class="px-3 py-3 self-center">
								{#if runningAgentName}
									<span class="text-sm truncate block {isQueued ? 'text-muted' : 'text-cyan'}">
										{runningAgentName}
									</span>
								{:else}
									<span class="text-sm text-muted truncate block">—</span>
								{/if}
							</div>

							<!-- Age -->
							<div class="px-3 py-3 self-center text-right">
								<span
									class="text-xs text-muted font-mono"
									title={parseUTC(issue.created_at).toLocaleString()}
								>
									{relTimeDiff(issue.created_at)}
								</span>
							</div>

							<!-- Dispatch button -->
							<div class="px-2 py-3 self-center">
								<button
									onclick={(e) => handleDispatch(e, issue)}
									disabled={!canDispatch}
									class="dispatch-btn w-7 h-7 flex items-center justify-center rounded border transition-colors {canDispatch ? 'border-edge text-muted hover:border-cyan hover:text-cyan hover:bg-cyan/10' : 'border-transparent text-muted/40 cursor-not-allowed'}"
									title={hasActiveAgent(issue) ? 'Agent already running' : 'Start work'}
								>
									{#if isDispatching}
										<svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
											<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="32" stroke-dashoffset="12" />
										</svg>
									{:else}
										<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
											<path d="M8 5v14l11-7z"/>
										</svg>
									{/if}
								</button>
							</div>
						</a>
					{/each}
				</div>
			</div>
	{/if}
	</div>

	<!-- Activity Terminal -->
	<div class="border-t border-edge">
		<ActivityTerminal {projectId} />
	</div>
</div>

<!-- New Issue Modal -->
<Modal open={form.open} onClose={() => form.close()} label="New Issue">
	<div class="flex items-center justify-between mb-5">
		<h2 class="text-primary font-bold uppercase tracking-wide text-sm">New Issue</h2>
		<button
			onclick={() => form.close()}
			class="text-muted hover:text-primary transition-colors text-xl leading-none"
			aria-label="Close modal"
		>
			×
		</button>
	</div>

	<form onsubmit={handleCreate} class="space-y-4">
		<div>
			<label for="issue-title" class="block text-xs text-muted uppercase tracking-widest mb-1.5">
				Title <span class="text-red">*</span>
			</label>
			<input
				id="issue-title"
				bind:value={form.fields.title}
				required
				placeholder="e.g. Fix authentication bug"
				class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-cyan transition-colors"
			/>
		</div>

		<div>
			<label
				for="issue-description"
				class="block text-xs text-muted uppercase tracking-widest mb-1.5"
			>
				Description <span class="text-red">*</span>
			</label>
			<textarea
				id="issue-description"
				bind:value={form.fields.description}
				required
				rows="4"
				placeholder="Describe the issue… (Markdown supported)"
				class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-cyan transition-colors resize-y"
			></textarea>
		</div>

		{#if form.error}
			<p class="text-red text-xs">{form.error}</p>
		{/if}

		<div class="flex gap-3 pt-1">
			<button
				type="submit"
				disabled={form.submitting}
				class="flex-1 py-2 bg-cyan/10 border border-cyan text-cyan text-sm font-medium rounded hover:bg-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wide"
			>
				{form.submitting ? 'Creating…' : 'Create Issue'}
			</button>
			<button
				type="button"
				onclick={() => form.close()}
				disabled={form.submitting}
				class="px-4 py-2 bg-surface border border-edge text-secondary text-sm rounded hover:border-edge-hi transition-colors disabled:opacity-50"
			>
				Cancel
			</button>
		</div>
	</form>
</Modal>

<style>
	/* Pulsing glow for in-progress badges */
	.badge-pulse {
		animation: pulse-glow 2s ease-in-out infinite;
	}

	/* Decision: raw rgba values used here instead of var(--glow-green) because
	   @keyframes requires discrete color values — the CSS variable holds a full
	   box-shadow rule, not just a color, so it can't be interpolated in keyframes. */
	@keyframes pulse-glow {
		0%,
		100% {
			box-shadow: 0 0 6px rgba(74, 222, 128, 0.3);
		}
		50% {
			box-shadow: 0 0 14px rgba(74, 222, 128, 0.55);
		}
	}

	/* Subtle left accent on in-progress rows to make them feel "alive" */
	.in-progress-row {
		box-shadow: inset 3px 0 0 rgba(74, 222, 128, 0.4);
	}

</style>
