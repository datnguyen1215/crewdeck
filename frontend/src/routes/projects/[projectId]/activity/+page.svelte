<script lang="ts">
	import { page } from '$app/stores';
	import { getContext } from 'svelte';
	import { listActivity, listIssues, type ActivityLog, type Issue } from '$lib/api/http.js';
	import type { ProjectWebSocket } from '$lib/api/ws.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';

	type ActivityEntry = ActivityLog;

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

	const ACTOR_CFG: Record<string, { icon: string; color: string; border: string; glow: string }> = {
		user: { icon: '○', color: 'text-primary', border: 'border-edge-hi', glow: '' },
		agent: { icon: '⬡', color: 'text-cyan', border: 'border-cyan', glow: 'var(--glow-cyan)' },
		orchestrator: {
			icon: '◈',
			color: 'text-purple',
			border: 'border-purple',
			glow: 'var(--glow-purple)'
		},
		system: { icon: '⚙', color: 'text-muted', border: 'border-edge', glow: '' }
	};

	const ACTION_LABELS: Record<string, (d: Record<string, unknown>) => string> = {
		'issue.created': () => 'Created issue',
		'issue.status_changed': (d) =>
			`Status: ${String(d.from).replace(/_/g, ' ')} → ${String(d.to).replace(/_/g, ' ')}`,
		'issue.priority_set': (d) => `Set priority to ${d.priority}`,
		'agent.assigned': (d) => `Assigned ${d.agent_name} to this issue`,
		'session.started': (d) => `Started work session${d.agent_name ? ` for ${d.agent_name}` : ''}`,
		'comment.added': () => 'Posted a comment',
		'review.requested': (d) => `Requested review from ${d.reviewer_name}`,
		'review.comment': () => 'Left a review comment',
		'review.approved': () => 'Approved the changes',
		'pr.created': (d) => `Created PR #${d.pr_number}`,
		'pr.merged': (d) => `Merged PR #${d.pr_number}`
	};

	const ACTION_DISPLAY: Record<string, string> = {
		'issue.created': 'Issue Created',
		'issue.status_changed': 'Status Changed',
		'issue.priority_set': 'Priority Set',
		'agent.assigned': 'Agent Assigned',
		'session.started': 'Session Started',
		'comment.added': 'Comment Added',
		'review.requested': 'Review Requested',
		'review.comment': 'Review Comment',
		'review.approved': 'Review Approved',
		'pr.created': 'PR Created',
		'pr.merged': 'PR Merged'
	};

	// Client-side pagination over fetched entries.
	const PAGE_SIZE = 50;

	let projectId = $derived($page.params.projectId);
	let allEntries = $state<ActivityEntry[]>([]);
	let issues = $state<Issue[]>([]);
	let loading = $state(true);
	let visibleCount = $state(PAGE_SIZE);

	let filterActors = $state<string[]>([]);
	let filterAction = $state('');
	let filterIssue = $state('');
	let expanded = $state<Set<string>>(new Set());

	$effect(() => {
		loading = true;
		visibleCount = PAGE_SIZE;
		let cancelled = false;
		// Pass active filters server-side so the limit is applied after filtering,
		// preventing silent exclusion of matching entries beyond the fetch limit.
		const actParams: Record<string, unknown> = { limit: 500 };
		if (filterActors.length > 0) actParams.actor_type = filterActors[0];
		if (filterAction) actParams.action = filterAction;
		if (filterIssue) actParams.issue_id = filterIssue;
		Promise.all([listActivity(projectId, actParams), listIssues(projectId)])
			.then(([acts, iss]) => {
				if (cancelled) return;
				allEntries = acts;
				issues = iss;
			})
			.catch(() => { if (!cancelled) toastStore.add('Failed to load activity', 'error'); })
			.finally(() => { if (!cancelled) loading = false; });
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const ws = getWs();
		if (!ws) return;
		const reload = () => {
			const actParams: Record<string, unknown> = { limit: 500 };
			if (filterActors.length > 0) actParams.actor_type = filterActors[0];
			if (filterAction) actParams.action = filterAction;
			if (filterIssue) actParams.issue_id = filterIssue;
			Promise.all([listActivity(projectId, actParams), listIssues(projectId)]).then(
				([acts, iss]) => {
					allEntries = acts;
					issues = iss;
				}
			).catch(() => {});
		};
		const unsub = ws.on('*', reload);
		return () => unsub();
	});

	// Filtering is applied server-side; allEntries already reflects active filters.
	let filtered = $derived(allEntries);

	let visible = $derived(filtered.slice(0, visibleCount));
	let hasMore = $derived(filtered.length > visibleCount);

	// Unique action types present in this project's data, for the filter dropdown.
	let actionTypes = $derived([...new Set(allEntries.map((e) => e.action))].sort());
	let issueMap = $derived(Object.fromEntries(issues.map((i) => [i.id, i.title])));

	// Intentional: static relative time — acceptable for a log viewer, not worth a timer.
	function relTime(dateStr: string): string {
		const diff = Date.now() - new Date(dateStr).getTime();
		const mins = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3_600_000);
		const days = Math.floor(diff / 86_400_000);
		if (days > 0) return `${days}d ago`;
		if (hours > 0) return `${hours}h ago`;
		if (mins > 0) return `${mins}m ago`;
		return 'just now';
	}

	function actorName(entry: ActivityEntry): string {
		if (entry.actor_type === 'agent' && entry.actor_id) {
			const n = String(entry.actor_id).replace('agent-', '');
			return n.charAt(0).toUpperCase() + n.slice(1);
		}
		if (entry.actor_type === 'orchestrator') return 'Orchestrator';
		if (entry.actor_type === 'system') return 'System';
		// TODO: Resolve actor_id to actual user name when multi-user support is added.
		return 'User';
	}

	function actionLabel(entry: ActivityEntry): string {
		const fn = ACTION_LABELS[entry.action];
		return fn ? fn((entry.details as Record<string, unknown>) ?? {}) : entry.action;
	}

	// Returns whether this entry has detail content worth expanding.
	function hasExpandable(entry: ActivityEntry): boolean {
		const d = (entry.details as Record<string, unknown>) ?? {};
		return !!(d.text || d.comment || d.reason || d.note || d.branch);
	}

	function toggleActor(actor: string) {
		filterActors = filterActors.includes(actor)
			? filterActors.filter((a) => a !== actor)
			: [...filterActors, actor];
		visibleCount = PAGE_SIZE;
	}

	function toggleExpand(id: string) {
		const next = new Set(expanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expanded = next;
	}

	function clearFilters() {
		filterActors = [];
		filterAction = '';
		filterIssue = '';
		visibleCount = PAGE_SIZE;
	}

	// Entries within the last 2 hours get a subtle glow treatment.
	function isRecent(dateStr: string): boolean {
		return Date.now() - new Date(dateStr).getTime() < 2 * 3_600_000;
	}
</script>

<div class="p-6 h-full overflow-auto">
	<!-- Header -->
	<div class="flex items-center justify-between mb-5">
		<div>
			<h1 class="text-xl font-bold text-primary uppercase tracking-wide">Activity</h1>
			<p class="text-muted text-xs mt-0.5">
				{#if !loading}
					{filtered.length} event{filtered.length !== 1 ? 's' : ''}
				{:else}
					Loading…
				{/if}
			</p>
		</div>
	</div>

	<!-- Filters -->
	<div class="mb-6 space-y-2">
		<!-- Actor type toggle pills -->
		<div class="flex flex-wrap items-center gap-1.5">
			<span class="text-xs text-muted uppercase tracking-widest mr-1 flex-shrink-0">Actor:</span>
			{#each Object.entries(ACTOR_CFG) as [type, cfg] (type)}
				<button
					onclick={() => toggleActor(type)}
					class="px-2 py-0.5 text-xs rounded border transition-colors {filterActors.includes(type)
						? `${cfg.color} ${cfg.border} bg-surface-hi`
						: 'text-muted border-edge hover:border-edge-hi hover:text-secondary'}"
				>
					{cfg.icon}
					{type.charAt(0).toUpperCase() + type.slice(1)}
				</button>
			{/each}
		</div>

		<!-- Action + Issue selects -->
		<div class="flex items-center gap-4 flex-wrap">
			<div class="flex items-center gap-2">
				<span class="text-xs text-muted uppercase tracking-widest">Action:</span>
				<select
					bind:value={filterAction}
					onchange={() => (visibleCount = PAGE_SIZE)}
					class="bg-surface border border-edge text-secondary text-xs rounded px-2 py-1 hover:border-edge-hi transition-colors cursor-pointer outline-none"
				>
					<option value="">All</option>
					{#each actionTypes as action (action)}
						<option value={action}>{ACTION_DISPLAY[action] ?? action}</option>
					{/each}
				</select>
			</div>

			<div class="flex items-center gap-2">
				<span class="text-xs text-muted uppercase tracking-widest">Issue:</span>
				<select
					bind:value={filterIssue}
					onchange={() => (visibleCount = PAGE_SIZE)}
					class="bg-surface border border-edge text-secondary text-xs rounded px-2 py-1 hover:border-edge-hi transition-colors cursor-pointer outline-none max-w-[180px]"
				>
					<option value="">All</option>
					{#each issues as issue (issue.id)}
						<option value={issue.id}>{issue.title}</option>
					{/each}
				</select>
			</div>

			{#if filterActors.length > 0 || filterAction || filterIssue}
				<button
					onclick={clearFilters}
					class="px-2 py-0.5 text-xs text-muted hover:text-secondary border border-transparent hover:border-edge rounded transition-colors"
				>
					Clear ×
				</button>
			{/if}
		</div>
	</div>

	<!-- Timeline -->
	{#if loading}
		<!-- Skeleton timeline while activity loads -->
		{@const skeletonWidths = [75, 55, 85, 65, 90, 60, 70, 80]}
		<div class="max-w-2xl relative fade-up">
			<div class="absolute left-[19px] top-2 bottom-0 w-px bg-edge pointer-events-none"></div>
			<div class="flex flex-col">
				{#each Array(8) as _, i}
					<div
						class="flex gap-4 pb-5 relative fade-up"
						style="animation-delay: {i * 40}ms"
					>
						<div class="flex-shrink-0 w-10 flex justify-center pt-0.5">
							<div class="skeleton w-6 h-6 rounded-full"></div>
						</div>
						<div class="flex-1 pt-0.5">
							<div class="flex items-center gap-2 mb-1.5">
								<div class="skeleton h-3 w-16 rounded"></div>
								<div class="skeleton h-3 w-12 rounded"></div>
							</div>
							<div class="skeleton h-4 rounded" style="width: {skeletonWidths[i]}%"></div>
							{#if i % 3 === 0}
								<div class="skeleton h-3 w-32 rounded mt-1.5"></div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{:else if filtered.length === 0}
		<p class="text-muted text-sm py-16 text-center">No activity matches the current filters.</p>
	{:else}
			<div class="max-w-2xl relative">
				<!-- Vertical line down the left -->
				<div class="absolute left-[19px] top-2 bottom-0 w-px bg-edge pointer-events-none"></div>

				<div class="flex flex-col">
					{#each visible as entry, i (entry.id)}
						{@const cfg = ACTOR_CFG[entry.actor_type] ?? ACTOR_CFG.system}
						{@const recent = isRecent(entry.created_at)}
						{@const expandable = hasExpandable(entry)}
						{@const isExpanded = expanded.has(entry.id)}
						{@const details = (entry.details as Record<string, unknown>) ?? {}}
						<div class="flex gap-4 pb-5 relative" style="animation: fade-up 0.25s ease both; animation-delay: {Math.min(i * 30, 300)}ms">
							<!-- Actor dot on the timeline -->
							<div class="flex-shrink-0 w-10 flex justify-center pt-0.5 relative z-10">
								<div
									class="w-6 h-6 rounded-full bg-base border flex items-center justify-center {cfg.border}"
									style={recent && cfg.glow ? `box-shadow: ${cfg.glow}` : ''}
								>
									<span class="text-[10px] leading-none {cfg.color}">{cfg.icon}</span>
								</div>
							</div>

							<!-- Event content -->
							<div class="flex-1 min-w-0 pt-0.5">
								<!-- Actor name + timestamp -->
								<div class="flex items-center gap-2 mb-0.5 flex-wrap">
									<span class="text-xs font-semibold {cfg.color}">{actorName(entry)}</span>
									<span
										class="text-muted text-xs font-mono"
										title={new Date(entry.created_at).toLocaleString()}
									>
										{relTime(entry.created_at)}
									</span>
								</div>

								<!-- Action description -->
								<p class="text-secondary text-sm">{actionLabel(entry)}</p>

								<!-- Related issue link -->
								{#if entry.issue_id}
									<a
										href="/projects/{projectId}/issues/{entry.issue_id}"
										class="text-xs text-muted hover:text-cyan transition-colors mt-0.5 inline-block font-mono"
									>
										#{entry.issue_id}{issueMap[entry.issue_id]
											? ` — ${issueMap[entry.issue_id]}`
											: ''}
									</a>
								{/if}

								<!-- Expandable details toggle -->
								{#if expandable}
									<button
										onclick={() => toggleExpand(entry.id)}
										class="mt-1.5 text-xs text-muted hover:text-secondary transition-colors flex items-center gap-1"
									>
										<span class="font-mono text-[10px]">{isExpanded ? '▾' : '▸'}</span>
										<span>{isExpanded ? 'Hide details' : 'Show details'}</span>
									</button>

									{#if isExpanded}
										<div
											class="mt-2 p-2.5 bg-base-hi border border-edge rounded text-xs text-secondary font-mono leading-relaxed"
										>
											{#if details.text}
												<p class="text-primary">"{details.text}"</p>
											{/if}
											{#if details.comment}
												<p class="text-primary">"{details.comment}"</p>
											{/if}
											{#if details.reason}
												<p class="text-muted mt-1">Reason: {details.reason}</p>
											{/if}
											{#if details.branch}
												<p class="text-muted mt-1">Branch: {details.branch}</p>
											{/if}
											{#if details.note}
												<p class="text-muted mt-1">{details.note}</p>
											{/if}
										</div>
									{/if}
								{/if}
							</div>
						</div>
					{/each}
				</div>

				<!-- Load more -->
				{#if hasMore}
					<div class="pl-14 pb-4">
						<button
							onclick={() => (visibleCount += PAGE_SIZE)}
							class="text-xs text-muted hover:text-secondary border border-edge hover:border-edge-hi rounded px-3 py-1.5 transition-colors"
						>
							Load more ({filtered.length - visibleCount} remaining)
						</button>
					</div>
				{/if}
			</div>
	{/if}
</div>
