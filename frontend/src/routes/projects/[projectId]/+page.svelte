<script lang="ts">
	import { page } from '$app/stores';
	import { getContext } from 'svelte';
	import { listIssues, createIssue, approveIssueStart, getProject, type IssueWithRunningAgent, type Agent, type Project } from '$lib/api/http.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import Modal from '$lib/components/Modal.svelte';
	import ActivityTerminal from '$lib/components/ActivityTerminal.svelte';
	import IssueFilters from '$lib/components/IssueFilters.svelte';
	import IssueCard from '$lib/components/IssueCard.svelte';
	import IssueTableRow from '$lib/components/IssueTableRow.svelte';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import { createFormState } from '$lib/utils/form.svelte.js';
	import { fetchEffect } from '$lib/utils/fetch-effect.svelte.js';
	import { useWsSubscriptions } from '$lib/utils/ws-subscriptions.js';

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

	// Base branch column toggle — persisted in localStorage
	let showBaseBranch = $state(
		typeof localStorage !== 'undefined'
			? localStorage.getItem('crewdeck:showBaseBranch') === 'true'
			: false
	);
	$effect(() => {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('crewdeck:showBaseBranch', String(showBaseBranch));
		}
	});

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
		return useWsSubscriptions(ws, {
			'issue.created': reload,
			'issue.updated': reload,
			'issue.status_changed': reload,
			'issue.paused': reload,
			'issue.resumed': reload,
			'mention.completed': reload,
			'run.started': reload,
			'run.completed': reload,
		});
	});

	let agentMap = $derived(Object.fromEntries(agents.map((a) => [a.id, a.name])));

	let filtered = $derived.by(() => {
		let result = [...issues];
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter((i) =>
				i.title.toLowerCase().includes(q) ||
				(i.description && i.description.toLowerCase().includes(q))
			);
		}
		if (!showCompleted && !filterStatuses.includes('done')) {
			result = result.filter((i) => i.status !== 'done');
		}
		if (filterStatuses.length > 0) {
			result = result.filter((i) => filterStatuses.includes(i.status));
		}
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
			await approveIssueStart(projectId, issue.id);
			toastStore.add('Issue approved — Captain will dispatch an engineer', 'success');
		} catch (err) {
			toastStore.add('Failed to approve issue start', 'error');
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
			issues = [...issues, { ...issue, running_agent_id: null, running_agent_status: null, dependencies: [], dependents: [] }];
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
			<div class="flex items-center gap-3 flex-wrap">
				<h1 class="text-lg md:text-xl font-bold text-primary uppercase tracking-wide">Issues</h1>
				{#if project}
					<a
						href="/projects/{projectId}/settings"
						class="text-muted text-xs uppercase tracking-wide hover:text-secondary transition-colors"
						title="Captain automation settings"
					>
						Auto: start {project.auto_start ? '✓' : '✗'} merge {project.auto_merge ? '✓' : '✗'}
					</a>
				{/if}
			</div>
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
	<IssueFilters
		bind:searchQuery
		bind:filterStatuses
		bind:filterAgent
		bind:sortField
		bind:sortDesc
		bind:showCompleted
		bind:showBaseBranch
		{agents}
	/>

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
				<div class="{showBaseBranch ? 'grid-cols-[1fr_148px_96px_100px_60px_44px]' : 'grid-cols-[1fr_148px_96px_60px_44px]'} grid text-xs text-muted uppercase tracking-widest bg-base-hi border-b border-edge">
					<div class="px-3 py-2.5">Title</div>
					<div class="px-3 py-2.5">Status</div>
					<div class="px-3 py-2.5">Agent</div>
					{#if showBaseBranch}<div class="px-3 py-2.5">Base</div>{/if}
					<div class="px-3 py-2.5 text-right">Age</div>
					<div class="px-2 py-2.5"></div>
				</div>
				{#each Array(8) as _, i}
					{@const skeletonWidths = [75, 60, 90, 55, 80, 65, 70, 85]}
					<div
						class="{showBaseBranch ? 'grid-cols-[1fr_148px_96px_100px_60px_44px]' : 'grid-cols-[1fr_148px_96px_60px_44px]'} grid border-b border-edge last:border-0 fade-up {i % 2 === 1 ? 'bg-base-hi' : 'bg-base'}"
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
						{#if showBaseBranch}<div class="px-3 py-3 flex items-center"><div class="skeleton h-4 w-12 rounded"></div></div>{/if}
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
				<IssueCard
					{issue}
					{projectId}
					{agentMap}
					{showBaseBranch}
					{project}
					isDispatching={dispatchingIssues.has(issue.id)}
					ondispatch={handleDispatch}
					animationDelay={i * 25}
				/>
			{/each}
		</div>

		<!-- Desktop table view -->
		<div class="overflow-x-auto hidden md:block">
				<div class="min-w-[560px] border border-edge rounded overflow-hidden">
					<!-- Table header -->
					<div
						class="grid {showBaseBranch ? 'grid-cols-[1fr_148px_96px_100px_60px_44px]' : 'grid-cols-[1fr_148px_96px_60px_44px]'} text-xs text-muted uppercase tracking-widest bg-base-hi border-b border-edge"
					>
						<div class="px-3 py-2.5">Title</div>
						<div class="px-3 py-2.5">Status</div>
						<div class="px-3 py-2.5">Agent</div>
						{#if showBaseBranch}
							<div class="px-3 py-2.5">Base</div>
						{/if}
						<div class="px-3 py-2.5 text-right">Age</div>
						<div class="px-2 py-2.5"></div>
					</div>

					<!-- Rows -->
					{#each filtered as issue, i (issue.id)}
						<IssueTableRow
							{issue}
							{projectId}
							{agentMap}
							{showBaseBranch}
							{project}
							isDispatching={dispatchingIssues.has(issue.id)}
							ondispatch={handleDispatch}
							index={i}
						/>
					{/each}
				</div>
			</div>
	{/if}
	</div>

	<!-- Activity Terminal -->
	<div class="border-t border-edge">
		<ActivityTerminal {projectId} {issues} />
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
