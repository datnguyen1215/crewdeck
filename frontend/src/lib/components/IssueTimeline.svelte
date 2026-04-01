<script lang="ts">
	import type { Comment, ActivityLog, AgentRun, AgentRunEvent } from '$lib/api/http.js';
	import { getRun } from '$lib/api/http.js';
	import { parseUTC } from '$lib/utils/time.js';
	import { mergeWithLiveEvents, createLiveEventSync } from '$lib/utils/run-events.svelte.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import TimelineCommentItem from './TimelineComment.svelte';
	import TimelineActivityItem from './TimelineActivity.svelte';

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
			expandedEvents = mergeWithLiveEvents(full.events, liveEvents, runId);
		} catch {
			expandedEvents = liveEvents.get(runId) ?? [];
			toastStore.add('Failed to load run events', 'error');
		} finally {
			loadingEvents = false;
		}
	}

	// Live-update inline expanded run events when new run events stream in
	$effect(createLiveEventSync(
		() => liveEvents,
		() => expandedRun,
		() => expandedEvents,
		(e) => { expandedEvents = e; }
	));

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
					<TimelineCommentItem
						comment={item.data}
						index={i}
						{editingCommentId}
						bind:editingCommentText
						{commentWorking}
						onStartEdit={onStartEditComment}
						onSaveEdit={onSaveEditComment}
						onCancelEdit={onCancelEditComment}
						onDelete={onDeleteComment}
					/>
				{:else}
					<TimelineActivityItem
						entry={item.data}
						index={i}
						{activityExpanded}
						{expandedRun}
						{expandedEvents}
						{loadingEvents}
						matchedRun={findRunForActivity(item.data)}
						spawnedRun={findRunForSpawnedActivity(item.data)}
						onToggleActivityExpand={toggleActivityExpand}
						onToggleRunExpand={toggleRunExpand}
						{onOpenRunModal}
					/>
				{/if}
			{/each}
		</div>
	</div>
{/if}
