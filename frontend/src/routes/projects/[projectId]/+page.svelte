<script lang="ts">
	import { page } from '$app/stores';
	import { listIssues, listAgents, listRepos, createIssue } from '$lib/mock/api.js';

	type Issue = Awaited<ReturnType<typeof listIssues>>[number];
	type Agent = Awaited<ReturnType<typeof listAgents>>[number];
	type Repo = Awaited<ReturnType<typeof listRepos>>[number];

	// Visual config per status — dot glyph, text/border color classes, optional glow + pulse
	const STATUS_CFG: Record<
		string,
		{ label: string; dot: string; text: string; border: string; glow?: string; pulse?: boolean; dashed?: boolean }
	> = {
		draft: { label: 'Draft', dot: '◌', text: 'text-muted', border: 'border-muted', dashed: true },
		open: { label: 'Open', dot: '○', text: 'text-blue', border: 'border-blue', glow: 'var(--glow-blue)' },
		in_progress: {
			label: 'In Progress',
			dot: '◉',
			text: 'text-green',
			border: 'border-green',
			glow: 'var(--glow-green)',
			pulse: true
		},
		in_review: {
			label: 'In Review',
			dot: '◉',
			text: 'text-amber',
			border: 'border-amber',
			glow: 'var(--glow-amber)'
		},
		feedback: {
			label: 'Feedback',
			dot: '◉',
			text: 'text-red',
			border: 'border-red',
			glow: 'var(--glow-red)'
		},
		ready: {
			label: 'Ready',
			dot: '●',
			text: 'text-green',
			border: 'border-green',
			glow: 'var(--glow-green)'
		},
		pr_created: {
			label: 'PR Created',
			dot: '◉',
			text: 'text-purple',
			border: 'border-purple',
			glow: 'var(--glow-purple)'
		},
		done: { label: 'Done', dot: '✓', text: 'text-secondary', border: 'border-secondary' }
	};

	let issues = $state<Issue[]>([]);
	let agents = $state<Agent[]>([]);
	let repos = $state<Repo[]>([]);
	let loading = $state(true);

	let projectId = $derived($page.params.projectId);

	// Filter state
	let filterStatuses = $state<string[]>([]);
	let filterAgent = $state('');

	// Sort state — priority descending by default
	let sortField = $state<'priority' | 'created_at' | 'updated_at'>('priority');
	let sortDesc = $state(true);

	// Modal state
	let showModal = $state(false);
	let newTitle = $state('');
	let newDescription = $state('');
	let newMaxRounds = $state('');
	let submitting = $state(false);

	$effect(() => {
		loading = true;
		let cancelled = false;
		Promise.all([listIssues(projectId), listAgents(projectId), listRepos(projectId)])
			.then(([i, a, r]) => {
				if (cancelled) return; // discard stale response if projectId changed
				issues = i;
				agents = a;
				repos = r;
				loading = false;
			})
			.catch(() => {
				if (!cancelled) loading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	let agentMap = $derived(Object.fromEntries(agents.map((a) => [a.id, a.name])));
	let repoMap = $derived(Object.fromEntries(repos.map((r) => [r.id, r.name])));

	let filtered = $derived.by(() => {
		let result = [...issues];
		if (filterStatuses.length > 0) {
			result = result.filter((i) => filterStatuses.includes(i.status));
		}
		if (filterAgent === '__unassigned__') {
			result = result.filter((i) => !i.assigned_agent_id);
		} else if (filterAgent) {
			result = result.filter((i) => i.assigned_agent_id === filterAgent);
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

	function age(dateStr: string): string {
		const diff = Date.now() - new Date(dateStr).getTime();
		// Decision: no guard for negative diff (future timestamps from clock skew).
		// All current timestamps are ago()-based; revisit when wired to real API.
		const mins = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);
		const weeks = Math.floor(days / 7);
		if (weeks > 0) return `${weeks}w`;
		if (days > 0) return `${days}d`;
		if (hours > 0) return `${hours}h`;
		return `${mins}m`;
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
		newMaxRounds = '';
	}

	function closeModal() {
		if (!submitting) {
			showModal = false;
			resetForm();
		}
	}

	async function handleCreate(e: SubmitEvent) {
		e.preventDefault();
		// Guard against whitespace-only inputs that pass HTML `required` without trimming.
		if (!newTitle.trim() || !newDescription.trim()) return;
		submitting = true;
		try {
			const issue = await createIssue(projectId, {
				title: newTitle.trim(),
				description: newDescription.trim(),
				// Decision: parseInt with type="number" input is safe here; NaN risk is
				// negligible. Revisit with Number.isFinite() check when wired to real API.
				max_review_rounds: newMaxRounds ? parseInt(newMaxRounds) : undefined
			});
			issues = [...issues, issue];
			showModal = false;
			resetForm();
		} finally {
			submitting = false;
			// Decision: no catch block — mock API never throws. When wired to a real API,
			// add error handling here to surface creation failures to the user.
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') closeModal();
	}
</script>

<svelte:window onkeydown={onKeydown} />

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
		</div>
	</div>

	<!-- Table / Empty state -->
	{#if loading}
		<!-- Skeleton table while issues load -->
		<div class="overflow-x-auto" style="animation: fade-up 0.3s ease both">
			<div class="min-w-[680px] border border-edge rounded overflow-hidden">
				<div class="grid grid-cols-[52px_1fr_148px_96px_96px_60px] text-xs text-muted uppercase tracking-widest bg-base-hi border-b border-edge">
					<div class="px-3 py-2.5 text-center">Pri</div>
					<div class="px-3 py-2.5">Title</div>
					<div class="px-3 py-2.5">Status</div>
					<div class="px-3 py-2.5">Agent</div>
					<div class="px-3 py-2.5">Repo</div>
					<div class="px-3 py-2.5 text-right">Age</div>
				</div>
				{#each Array(8) as _, i}
					<div
						class="grid grid-cols-[52px_1fr_148px_96px_96px_60px] border-b border-edge last:border-0 {i % 2 === 1 ? 'bg-base-hi' : 'bg-base'}"
						style="animation: fade-up 0.3s ease both; animation-delay: {i * 30}ms"
					>
						<div class="px-3 py-3 flex justify-center items-center">
							<div class="skeleton h-4 w-6 rounded"></div>
						</div>
						<div class="px-3 py-3 flex items-center gap-2">
							<div class="skeleton h-4 rounded" style="width: {60 + (i * 17) % 30}%"></div>
						</div>
						<div class="px-3 py-3 flex items-center">
							<div class="skeleton h-5 w-24 rounded"></div>
						</div>
						<div class="px-3 py-3 flex items-center">
							<div class="skeleton h-4 w-16 rounded"></div>
						</div>
						<div class="px-3 py-3 flex items-center">
							<div class="skeleton h-4 w-14 rounded"></div>
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
				<div class="min-w-[680px] border border-edge rounded overflow-hidden">
					<!-- Table header -->
					<div
						class="grid grid-cols-[52px_1fr_148px_96px_96px_60px] text-xs text-muted uppercase tracking-widest bg-base-hi border-b border-edge"
					>
						<div class="px-3 py-2.5 text-center">Pri</div>
						<div class="px-3 py-2.5">Title</div>
						<div class="px-3 py-2.5">Status</div>
						<div class="px-3 py-2.5">Agent</div>
						<div class="px-3 py-2.5">Repo</div>
						<div class="px-3 py-2.5 text-right">Age</div>
					</div>

					<!-- Rows -->
					{#each filtered as issue, i (issue.id)}
						{@const cfg = STATUS_CFG[issue.status] ?? STATUS_CFG.open}
						<a
							href="/projects/{projectId}/issues/{issue.id}"
							class="issue-row grid grid-cols-[52px_1fr_148px_96px_96px_60px] border-b border-edge last:border-0 hover:bg-surface-hi transition-colors group {i % 2 === 1 ? 'bg-base-hi' : 'bg-base'} {issue.status === 'in_progress' ? 'in-progress-row' : ''}"
							style="animation: fade-up 0.25s ease both; animation-delay: {i * 25}ms"
						>
							<!-- Priority -->
							<div
								class="px-3 py-3 text-center self-center text-sm font-mono {priorityColor(issue.priority)}"
							>
								{!issue.priority || issue.status === 'draft' ? '—' : issue.priority}
							</div>

							<!-- Title -->
							<div class="px-3 py-3 self-center min-w-0">
								<p class="text-primary text-sm truncate group-hover:text-cyan transition-colors">
									{issue.title}
								</p>
								{#if issue.created_by === 'orchestrator'}
									<p class="text-muted text-xs mt-0.5">proposed by orchestrator</p>
								{/if}
							</div>

							<!-- Status badge -->
							<div class="px-3 py-3 self-center">
								<span
									class="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border {cfg.text} {cfg.border} {cfg.dashed ? 'border-dashed' : ''} {cfg.pulse ? 'badge-pulse' : ''}"
									style={cfg.glow ? `box-shadow: ${cfg.glow}` : ''}
								>
									<span class="leading-none">{cfg.dot}</span>
									{cfg.label}
								</span>
							</div>

							<!-- Agent -->
							<div class="px-3 py-3 self-center">
								<span
									class="text-sm {issue.assigned_agent_id ? 'text-secondary' : 'text-muted'} truncate block"
								>
									{agentMap[issue.assigned_agent_id ?? ''] ?? '—'}
								</span>
							</div>

							<!-- Repo -->
							<div class="px-3 py-3 self-center">
								<span class="text-sm {issue.repo_id ? 'text-secondary' : 'text-muted'} truncate block">
									{repoMap[issue.repo_id ?? ''] ?? '—'}
								</span>
							</div>

							<!-- Age -->
							<div class="px-3 py-3 self-center text-right">
								<span
									class="text-xs text-muted font-mono"
									title={new Date(issue.created_at).toLocaleString()}
								>
									{age(issue.created_at)}
								</span>
							</div>
						</a>
					{/each}
				</div>
			</div>
	{/if}
</div>

<!-- New Issue Modal -->
{#if showModal}
	<!-- Backdrop — click outside to close -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={(e) => e.target === e.currentTarget && closeModal()}
		role="dialog"
		aria-modal="true"
		aria-label="New Issue"
	>
		<div class="bg-surface border border-edge rounded w-full max-w-lg mx-4 p-6 shadow-2xl">
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

				<div>
					<label for="issue-rounds" class="block text-xs text-muted uppercase tracking-widest mb-1.5">
						Max Review Rounds
					</label>
					<input
						id="issue-rounds"
						bind:value={newMaxRounds}
						type="number"
						min="1"
						max="10"
						placeholder="Uses project default: 3"
						class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-cyan transition-colors"
					/>
				</div>

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
		</div>
	</div>
{/if}

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

	/* Row hover: left-to-right highlight sweep effect */
	.issue-row {
		position: relative;
		overflow: hidden;
	}

	.issue-row::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, transparent 0%, rgba(34, 211, 238, 0.03) 50%, transparent 100%);
		transform: translateX(-100%);
		transition: transform 400ms ease;
		pointer-events: none;
	}

	.issue-row:hover::after {
		transform: translateX(100%);
	}
</style>
