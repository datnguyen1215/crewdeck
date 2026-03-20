<script lang="ts">
	import { page } from '$app/stores';
	import { getContext } from 'svelte';
	import { listIssues, listAgents, createIssue, type Issue, type Agent } from '$lib/api/http.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import Modal from '$lib/components/Modal.svelte';
	import { STATUS_CFG } from '$lib/config/status.js';
	import { parseUTC, relTimeDiff } from '$lib/utils/time.js';

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

	let issues = $state<Issue[]>([]);
	let agents = $state<Agent[]>([]);
	let loading = $state(true);

	let projectId = $derived($page.params.projectId!);

	// Filter state
	let filterStatuses = $state<string[]>([]);
	let filterAgent = $state('');
	let showCompleted = $state(false);

	// Sort state — newest first by default
	let sortField = $state<'priority' | 'created_at' | 'updated_at'>('created_at');
	let sortDesc = $state(true);

	// Modal state
	let showModal = $state(false);
	let newTitle = $state('');
	let newDescription = $state('');
	let submitting = $state(false);

	$effect(() => {
		loading = true;
		let cancelled = false;
		Promise.all([listIssues(projectId), listAgents()])
			.then(([i, a]) => {
				if (cancelled) return; // discard stale response if projectId changed
				issues = i;
				agents = a;
				loading = false;
			})
			.catch(() => {
				if (!cancelled) loading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const ws = getWs();
		if (!ws) return;
		const reload = () => {
			Promise.all([listIssues(projectId), listAgents()])
				.then(([i, a]) => { issues = i; agents = a; })
				.catch(() => {});
		};
		const unsubs = [
			ws.on('issue.created', reload),
			ws.on('issue.updated', reload),
			ws.on('issue.status_changed', reload),
			ws.on('mention.completed', reload),
			ws.on('run.started', reload),
			ws.on('run.completed', reload),
		];
		return () => unsubs.forEach(fn => fn());
	});

	let agentMap = $derived(Object.fromEntries(agents.map((a) => [a.id, a.name])));

	let filtered = $derived.by(() => {
		let result = [...issues];
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
			const av = sortField === 'priority' ? (a.priority ?? -1) : a[sortField];
			const bv = sortField === 'priority' ? (b.priority ?? -1) : b[sortField];
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


	function priorityColor(priority: number): string {
		if (!priority) return 'text-muted';
		if (priority >= 8) return 'text-amber';
		if (priority >= 5) return 'text-blue';
		return 'text-secondary';
	}

	function resetForm() {
		newTitle = '';
		newDescription = '';
	}

	function closeModal() {
		if (!submitting) {
			showModal = false;
			resetForm();
		}
	}

	let formError = $state('');

	async function handleCreate(e: SubmitEvent) {
		e.preventDefault();
		// Guard against whitespace-only inputs that pass HTML `required` without trimming.
		if (!newTitle.trim() || !newDescription.trim()) return;
		submitting = true;
		formError = '';
		try {
			const issue = await createIssue(projectId, {
				title: newTitle.trim(),
				description: newDescription.trim()
			});
			issues = [...issues, issue];
			showModal = false;
			resetForm();
		} catch (err) {
			formError = err instanceof Error ? err.message : 'Failed to create issue';
		} finally {
			submitting = false;
		}
	}

</script>

<div class="p-6 h-full overflow-auto">
	<!-- Header -->
	<div class="flex items-center justify-between mb-5">
		<div>
			<h1 class="text-xl font-bold text-primary uppercase tracking-wide">Issues</h1>
			<p class="text-muted text-xs mt-0.5">
				{#if !loading}{filtered.length} of {issues.length} issues{:else}Loading…{/if}
			</p>
		</div>
		<button
			onclick={() => (showModal = true)}
			class="px-3 py-1.5 bg-surface border border-edge text-primary text-xs font-medium rounded hover:border-edge-hi hover:bg-surface-hi transition-colors uppercase tracking-wide"
		>
			+ New Issue
		</button>
	</div>

	<!-- Filters -->
	<div class="mb-5 space-y-2.5">
		<!-- Status toggle pills -->
		<div class="flex flex-wrap items-center gap-1.5">
			<span class="text-xs text-muted uppercase tracking-widest mr-1">Status:</span>
			{#each Object.entries(STATUS_CFG) as [key, cfg] (key)}
				<button
					onclick={() => toggleStatus(key)}
					class="px-2 py-0.5 text-xs rounded border transition-colors {filterStatuses.includes(key)
						? `${cfg.text} ${cfg.border} bg-surface-hi`
						: 'text-muted border-edge hover:border-edge-hi hover:text-secondary'}"
				>
					{cfg.label}
				</button>
			{/each}
			{#if filterStatuses.length > 0}
				<button
					onclick={() => (filterStatuses = [])}
					class="px-2 py-0.5 text-xs text-muted hover:text-secondary border border-transparent hover:border-edge rounded transition-colors ml-1"
				>
					Clear ×
				</button>
			{/if}
		</div>

		<!-- Agent + Sort controls -->
		<div class="flex items-center gap-4 flex-wrap">
			<div class="flex items-center gap-2">
				<span class="text-xs text-muted uppercase tracking-widest">Agent:</span>
				<select
					bind:value={filterAgent}
					class="bg-surface border border-edge text-secondary text-xs rounded px-2 py-1 hover:border-edge-hi transition-colors cursor-pointer outline-none"
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
					class="bg-surface border border-edge text-secondary text-xs rounded px-2 py-1 hover:border-edge-hi transition-colors cursor-pointer outline-none"
				>
					<option value="priority">Priority</option>
					<option value="created_at">Created</option>
					<option value="updated_at">Updated</option>
				</select>
				<button
					onclick={() => (sortDesc = !sortDesc)}
					class="px-2 py-1 bg-surface border border-edge text-secondary text-xs rounded hover:border-edge-hi hover:text-primary transition-colors"
					title={sortDesc ? 'Descending' : 'Ascending'}
				>
					{sortDesc ? '↓ Desc' : '↑ Asc'}
				</button>
			</div>

			<label class="flex items-center gap-1.5 cursor-pointer">
				<input
					type="checkbox"
					bind:checked={showCompleted}
					class="accent-cyan"
				/>
				<span class="text-xs text-muted">Show completed</span>
			</label>
		</div>
	</div>

	<!-- Table / Empty state -->
	{#if loading}
		<!-- Skeleton table while issues load -->
		<div class="overflow-x-auto fade-up">
			<div class="min-w-[580px] border border-edge rounded overflow-hidden">
				<div class="grid grid-cols-[52px_1fr_148px_96px_60px] text-xs text-muted uppercase tracking-widest bg-base-hi border-b border-edge">
					<div class="px-3 py-2.5 text-center">Pri</div>
					<div class="px-3 py-2.5">Title</div>
					<div class="px-3 py-2.5">Status</div>
					<div class="px-3 py-2.5">Agent</div>
					<div class="px-3 py-2.5 text-right">Age</div>
				</div>
				{#each Array(8) as _, i}
					{@const skeletonWidths = [75, 60, 90, 55, 80, 65, 70, 85]}
					<div
						class="grid grid-cols-[52px_1fr_148px_96px_60px] border-b border-edge last:border-0 fade-up {i % 2 === 1 ? 'bg-base-hi' : 'bg-base'}"
					style="animation-delay: {i * 30}ms"
					>
						<div class="px-3 py-3 flex justify-center items-center">
							<div class="skeleton h-4 w-6 rounded"></div>
						</div>
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
					</div>
				{/each}
			</div>
		</div>
	{:else if issues.length === 0}
			<div class="flex flex-col items-center justify-center py-24 text-center">
				<p class="text-primary text-lg font-semibold mb-1">No issues yet</p>
				<p class="text-muted text-sm mb-6">Create your first issue to get started</p>
				<button
					onclick={() => (showModal = true)}
					class="px-4 py-2 bg-surface border border-edge text-primary text-sm rounded hover:border-edge-hi hover:bg-surface-hi transition-colors uppercase tracking-wide"
				>
					+ Create Issue
				</button>
			</div>
	{:else if filtered.length === 0}
		<div class="py-16 text-center">
			<p class="text-muted text-sm">No issues match the current filters.</p>
		</div>
	{:else}
		<div class="overflow-x-auto">
				<div class="min-w-[580px] border border-edge rounded overflow-hidden">
					<!-- Table header -->
					<div
						class="grid grid-cols-[52px_1fr_148px_96px_60px] text-xs text-muted uppercase tracking-widest bg-base-hi border-b border-edge"
					>
						<div class="px-3 py-2.5 text-center">Pri</div>
						<div class="px-3 py-2.5">Title</div>
						<div class="px-3 py-2.5">Status</div>
						<div class="px-3 py-2.5">Agent</div>
						<div class="px-3 py-2.5 text-right">Age</div>
					</div>

					<!-- Rows -->
					{#each filtered as issue, i (issue.id)}
						{@const cfg = STATUS_CFG[issue.status] ?? STATUS_CFG.open}
						{@const runningAgentName = issue.running_agent_id ? agentMap[issue.running_agent_id] : null}
						{@const isQueued = issue.running_agent_status === 'queued'}
						<a
							href="/projects/{projectId}/issues/{issue.id}"
							class="issue-row grid grid-cols-[52px_1fr_148px_96px_60px] border-b border-edge last:border-0 hover:bg-surface-hi transition-colors group {i % 2 === 1 ? 'bg-base-hi' : 'bg-base'} {issue.status === 'in_progress' ? 'in-progress-row' : ''}"
							style="animation: fade-up 0.25s ease both; animation-delay: {i * 25}ms"
						>
							<!-- Priority -->
							<div
								class="px-3 py-3 text-center self-center text-sm font-mono {priorityColor(issue.priority)}"
							>
								{issue.priority || '—'}
							</div>

							<!-- Title -->
							<div class="px-3 py-3 self-center min-w-0">
								<p class="text-primary text-sm truncate group-hover:text-cyan transition-colors">
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
						</a>
					{/each}
				</div>
			</div>
	{/if}
</div>

<!-- New Issue Modal -->
<Modal open={showModal} onClose={closeModal} label="New Issue">
	<div class="flex items-center justify-between mb-5">
		<h2 class="text-primary font-bold uppercase tracking-wide text-sm">New Issue</h2>
		<button
			onclick={closeModal}
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
				bind:value={newTitle}
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
				bind:value={newDescription}
				required
				rows="4"
				placeholder="Describe the issue… (Markdown supported)"
				class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-cyan transition-colors resize-y"
			></textarea>
		</div>

		{#if formError}
			<p class="text-red text-xs">{formError}</p>
		{/if}

		<div class="flex gap-3 pt-1">
			<button
				type="submit"
				disabled={submitting}
				class="flex-1 py-2 bg-cyan/10 border border-cyan text-cyan text-sm font-medium rounded hover:bg-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wide"
			>
				{submitting ? 'Creating…' : 'Create Issue'}
			</button>
			<button
				type="button"
				onclick={closeModal}
				disabled={submitting}
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
