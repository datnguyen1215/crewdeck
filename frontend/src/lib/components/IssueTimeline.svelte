<script lang="ts">
	import type { Comment, ActivityLog, AgentRun, AgentRunEvent } from '$lib/api/http.js';
	import { getRun } from '$lib/api/http.js';
	import { untrack } from 'svelte';
	import { relTime, parseUTC } from '$lib/utils/time.js';
	import { md } from '$lib/utils/markdown.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import { ACTOR_CFG, actorName, actionLabel, hasExpandableDetails } from '$lib/activity.js';
	import { RUN_STATUS_DOT, RUN_STATUS_CFG } from '$lib/config/status.js';
	import ActivityDetails from './ActivityDetails.svelte';

	let {
		comments,
		activityEntries,
		runs,
		liveEvents,
		projectId,
		issueId,
		loading,
		editingCommentId,
		editingCommentText = $bindable(''),
		commentWorking,
		onStartEditComment,
		onSaveEditComment,
		onCancelEditComment,
		onDeleteComment,
		onOpenRunModal
	}: {
		comments: Comment[];
		activityEntries: ActivityLog[];
		runs: AgentRun[];
		liveEvents: Map<string, AgentRunEvent[]>;
		projectId: string;
		issueId: string;
		loading: boolean;
		editingCommentId: string | null;
		editingCommentText: string;
		commentWorking: boolean;
		onStartEditComment: (comment: Comment) => void;
		onSaveEditComment: () => void;
		onCancelEditComment: () => void;
		onDeleteComment: (id: string) => void;
		onOpenRunModal: (run: AgentRun) => void;
	} = $props();

	let activityExpanded = $state<Set<string>>(new Set());
	let expandedRun = $state<string | null>(null);
	let expandedEvents = $state<AgentRunEvent[]>([]);
	let loadingEvents = $state(false);

	type TimelineComment = { type: 'comment'; created_at: string; data: Comment };
	type TimelineActivity = { type: 'activity'; created_at: string; data: ActivityLog };
	type TimelineItem = TimelineComment | TimelineActivity;

	const timeline = $derived.by(() => {
		const items: TimelineItem[] = [
			...comments.map(c => ({ type: 'comment' as const, created_at: c.created_at, data: c })),
			...activityEntries
				.filter(a => a.action !== 'comment.added')
				.map(a => ({ type: 'activity' as const, created_at: a.created_at, data: a }))
		];
		return items.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
	});

	function findRunForActivity(activity: ActivityLog): AgentRun | undefined {
		if (activity.action !== 'mention.completed') return undefined;
		const details = activity.details as Record<string, unknown>;
		const agentId = details.agent_id as string | undefined;
		if (!agentId) return undefined;
		const activityTime = parseUTC(activity.created_at).getTime();
		return runs.find(r => {
			if (r.agent_id !== agentId) return false;
			if (!r.completed_at) return false;
			const runTime = parseUTC(r.completed_at).getTime();
			return Math.abs(runTime - activityTime) < 60000;
		});
	}

	function findRunForSpawnedActivity(activity: ActivityLog): AgentRun | undefined {
		if (activity.action !== 'mention.spawned') return undefined;
		const details = activity.details as Record<string, unknown>;
		const agentId = details.agent_id as string | undefined;
		if (!agentId) return undefined;
		const activityTime = parseUTC(activity.created_at).getTime();
		return runs.find(r => {
			if (r.agent_id !== agentId) return false;
			if (!r.started_at) return false;
			const runTime = parseUTC(r.started_at).getTime();
			return Math.abs(runTime - activityTime) < 60000;
		});
	}

	function toggleActivityExpand(id: string) {
		const next = new Set(activityExpanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		activityExpanded = next;
	}

	async function toggleRunExpand(runId: string) {
		if (expandedRun === runId) {
			expandedRun = null;
			expandedEvents = [];
			return;
		}
		expandedRun = runId;
		loadingEvents = true;
		try {
			const full = await getRun(projectId, runId);
			// Guard against stale responses if the user clicked a different run before this resolved
			if (expandedRun !== runId) return;
			const apiEvents = full.events;
			const live = liveEvents.get(runId) ?? [];
			const apiEventIds = new Set(apiEvents.map(e => e.id));
			const newLiveEvents = live.filter(e => !apiEventIds.has(e.id));
			expandedEvents = [...apiEvents, ...newLiveEvents];
		} catch {
			expandedEvents = liveEvents.get(runId) ?? [];
			toastStore.add('Failed to load run events', 'error');
		} finally {
			loadingEvents = false;
		}
	}

	// Live-update inline expanded run events when new run events stream in
	$effect(() => {
		if (!expandedRun) return;
		const live = liveEvents.get(expandedRun) ?? [];
		if (live.length === 0) return;
		// Use untrack to read expandedEvents without creating a reactive dependency
		const existingIds = new Set(untrack(() => expandedEvents).map(e => e.id));
		const newEvents = live.filter(e => !existingIds.has(e.id));
		if (newEvents.length > 0) {
			expandedEvents = [...untrack(() => expandedEvents), ...newEvents];
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

	function commentStyle(authorType: string): { border: string; textColor: string } {
		if (authorType === 'system') return { border: 'var(--color-muted)', textColor: 'text-muted' };
		if (authorType === 'user') return { border: 'var(--color-edge-hi)', textColor: 'text-secondary' };
		return { border: 'var(--color-cyan)', textColor: 'text-cyan' };
	}

	function commentAuthorLabel(comment: Comment): string {
		if (comment.author_type === 'system') return 'System';
		if (comment.author_type === 'user') return 'User';
		return comment.author_type.charAt(0).toUpperCase() + comment.author_type.slice(1);
	}
</script>

{#if loading}
	<div class="flex flex-col gap-3">
		{#each Array(5) as _, i}
			<div class="flex gap-3 animate-pulse" style="animation-delay: {i * 50}ms">
				<div class="skeleton w-5 h-5 rounded-full shrink-0"></div>
				<div class="flex-1"><div class="skeleton h-3 w-24 rounded mb-1"></div><div class="skeleton h-4 w-3/4 rounded"></div></div>
			</div>
		{/each}
	</div>
{:else if timeline.length === 0}
	<p class="text-muted text-sm py-8 text-center">No activity yet.</p>
{:else}
	<div class="relative mb-6">
		<div class="absolute left-[9px] top-2 bottom-0 w-px bg-edge pointer-events-none"></div>
		<div class="flex flex-col">
			{#each timeline as item, i (item.type === 'comment' ? `c-${item.data.id}` : `a-${item.data.id}`)}
				{#if item.type === 'comment'}
					{@const comment = item.data}
					{@const cs = commentStyle(comment.author_type)}
					<div
						class="flex gap-3 pb-4 relative"
						style="animation: fade-up 0.2s ease both; animation-delay: {Math.min(i * 25, 200)}ms"
					>
						<div class="flex-shrink-0 w-5 flex justify-center pt-0.5 relative z-10">
							<div
								class="w-5 h-5 rounded-full bg-base border flex items-center justify-center"
								style="border-color: {cs.border}"
							>
								<span class="text-[9px] leading-none {cs.textColor}">
									{#if comment.author_type === 'system'}⚙{:else if comment.author_type === 'user'}○{:else}⬡{/if}
								</span>
							</div>
						</div>

						<div class="flex-1 min-w-0">
							<div
								class="border border-edge rounded-r rounded-tl rounded-bl bg-base p-3"
								style="border-left: 3px solid {cs.border}"
							>
								<div class="flex items-center gap-2 mb-2 flex-wrap">
									<span class="text-xs font-semibold {cs.textColor}">
										{commentAuthorLabel(comment)}
									</span>
									<span class="text-xs text-muted" title={parseUTC(comment.created_at).toLocaleString()}>
										{relTime(comment.created_at)}
									</span>
									{#if comment.author_type === 'user'}
										<div class="ml-auto flex gap-1">
											<button
												onclick={() => onStartEditComment(comment)}
												class="text-xs text-muted hover:text-secondary transition-colors px-1"
												title="Edit comment"
											>edit</button>
											<button
												onclick={() => onDeleteComment(comment.id)}
												class="text-xs text-muted hover:text-red transition-colors px-1"
												title="Delete comment"
											>delete</button>
										</div>
									{/if}
								</div>
								{#if editingCommentId === comment.id}
									<div class="flex flex-col gap-2">
										<textarea
											bind:value={editingCommentText}
											rows={3}
											class="w-full bg-base border border-edge rounded px-3 py-2 text-secondary text-sm resize-none focus:border-cyan focus:outline-none"
										></textarea>
										<div class="flex gap-2">
											<button onclick={onSaveEditComment} disabled={commentWorking || !editingCommentText.trim()} class="px-3 py-1 text-xs border border-cyan text-cyan rounded hover:bg-cyan/10 disabled:opacity-50 transition-colors">Save</button>
											<button onclick={onCancelEditComment} class="px-3 py-1 text-xs border border-edge text-muted rounded hover:text-secondary transition-colors">Cancel</button>
										</div>
									</div>
								{:else}
									<div class="issue-prose text-secondary text-sm leading-relaxed">
										{@html md(comment.content)}
									</div>
								{/if}
							</div>
						</div>
					</div>
				{:else}
					{@const entry = item.data}
					{@const cfg = ACTOR_CFG[entry.actor_type] ?? ACTOR_CFG.system}
					{@const expandable = hasExpandableDetails(entry)}
					{@const isExp = activityExpanded.has(entry.id)}
					{@const matchedRun = findRunForActivity(entry)}
					{@const spawnedRun = findRunForSpawnedActivity(entry)}
					<div
						class="flex gap-3 pb-4 relative"
						style="animation: fade-up 0.2s ease both; animation-delay: {Math.min(i * 25, 200)}ms"
					>
						<div class="flex-shrink-0 w-5 flex justify-center pt-0.5 relative z-10">
							<div class="w-5 h-5 rounded-full bg-base border border-edge flex items-center justify-center">
								<span class="text-[9px] leading-none {cfg.color}">{cfg.icon}</span>
							</div>
						</div>

						<div class="flex-1 min-w-0 pt-0.5">
							<div class="flex items-center gap-2 mb-0.5 flex-wrap">
								<span class="text-xs font-semibold {cfg.color}">{actorName(entry)}</span>
								{#if spawnedRun}
									{@const dotCfg = RUN_STATUS_DOT[spawnedRun.status] ?? RUN_STATUS_DOT.queued}
									<span class="text-[10px] {dotCfg.class}" class:animate-pulse={dotCfg.pulse} title={spawnedRun.status}>{dotCfg.dot}</span>
								{/if}
								<span class="text-muted text-xs font-mono" title={parseUTC(entry.created_at).toLocaleString()}>
									{relTime(entry.created_at)}
								</span>
							</div>

							<p class="text-secondary text-sm">{actionLabel(entry)}</p>

							{#if spawnedRun}
								<button
									onclick={() => onOpenRunModal(spawnedRun)}
									class="mt-1 text-xs text-muted hover:text-cyan transition-colors flex items-center gap-1"
								>
									<span class="font-mono text-[10px]">▸</span>
									<span>View</span>
								</button>
							{/if}

							{#if matchedRun}
								{@const runCfg = RUN_STATUS_CFG[matchedRun.status] ?? RUN_STATUS_CFG.queued}
								<div class="mt-1.5 flex items-center gap-2 text-xs">
									<span class="px-1.5 py-0.5 rounded border {runCfg.class}">{runCfg.label}</span>
									<span class="text-muted">{formatDuration(matchedRun.duration_ms)} | {formatCost(matchedRun.cost_usd)}</span>
									<button
										onclick={() => toggleRunExpand(matchedRun.id)}
										class="text-muted hover:text-secondary transition-colors flex items-center gap-1"
									>
										<span class="font-mono text-[10px]">{expandedRun === matchedRun.id ? '▾' : '▸'}</span>
										<span>{expandedRun === matchedRun.id ? 'Hide' : 'Details'}</span>
									</button>
								</div>
								{#if expandedRun === matchedRun.id}
									<div class="mt-1.5 p-2 bg-base-hi border border-edge rounded text-xs max-h-60 overflow-y-auto">
										{#if loadingEvents}
											<div class="animate-pulse text-muted">Loading events...</div>
										{:else if expandedEvents.length === 0}
											<p class="text-muted">No events recorded.</p>
										{:else}
											<div class="flex flex-col gap-2">
												{#each expandedEvents as event (event.id)}
													<div class="flex gap-2">
														<span class="shrink-0 w-20 text-muted font-mono">{event.type}</span>
														<span class="text-secondary break-all">{renderEventContent(event)}</span>
													</div>
												{/each}
												{#if matchedRun.status === 'running'}
													<div class="flex gap-2 animate-pulse">
														<span class="shrink-0 w-20 text-green font-mono">...</span>
														<span class="text-green">Processing</span>
													</div>
												{/if}
											</div>
										{/if}
									</div>
								{/if}
							{/if}

							{#if expandable}
								<button
									onclick={() => toggleActivityExpand(entry.id)}
									class="mt-1 text-xs text-muted hover:text-secondary transition-colors flex items-center gap-1"
								>
									<span class="font-mono text-[10px]">{isExp ? '▾' : '▸'}</span>
									<span>{isExp ? 'Hide' : 'Details'}</span>
								</button>
								{#if isExp}
									<div class="mt-1.5 p-2 bg-base-hi border border-edge rounded text-xs text-secondary font-mono leading-relaxed">
										<ActivityDetails details={(entry.details as Record<string, unknown>) ?? {}} />
									</div>
								{/if}
							{/if}
						</div>
					</div>
				{/if}
			{/each}
		</div>
	</div>
{/if}
