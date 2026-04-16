<script lang="ts">
	import type { ActivityLog } from '$lib/api/http.js';
	import { actorName, actionLabel } from '$lib/activity.js';
	import { formatTime } from '$lib/utils/time.js';

	let {
		entries,
		loading
	}: {
		entries: ActivityLog[];
		loading: boolean;
	} = $props();

	/** Border color based on actor name/type for terminal severity indicator */
	function borderColor(entry: ActivityLog): string {
		const name = entry.actor_name?.toLowerCase() ?? '';
		if (name === 'captain' || name === 'inspector') return 'border-l-cyan';
		if (name === 'engineer') return 'border-l-green';
		if (name === 'librarian') return 'border-l-purple';
		if (name === 'docs') return 'border-l-purple';
		switch (entry.actor_type) {
			case 'agent': return 'border-l-cyan';
			case 'user': return 'border-l-green';
			case 'system': return 'border-l-purple';
			default: return 'border-l-muted';
		}
	}

	/** Text color based on actor name/type */
	function actorColor(entry: ActivityLog): string {
		const name = entry.actor_name?.toLowerCase() ?? '';
		if (name === 'captain' || name === 'inspector') return 'text-cyan';
		if (name === 'engineer') return 'text-green';
		if (name === 'librarian') return 'text-purple';
		if (name === 'docs') return 'text-purple';
		switch (entry.actor_type) {
			case 'agent': return 'text-cyan';
			case 'user': return 'text-green';
			case 'system': return 'text-purple';
			default: return 'text-secondary';
		}
	}

</script>

<div class="bg-surface border border-edge rounded-sm flex flex-col h-full min-w-0">
	<!-- Pane header -->
	<div class="flex items-center px-4 py-2 bg-base-hi rounded-t-sm">
		<span class="text-muted text-sm font-mono">mission.log</span>
	</div>

	{#if loading}
		<div class="p-3 space-y-1.5">
			{#each Array(6) as _}
				<div class="skeleton h-3 w-full rounded"></div>
			{/each}
		</div>
	{:else if entries.length === 0}
		<div class="flex-1 flex items-center justify-center py-8 px-4">
			<p class="text-muted text-xs font-mono">No recent activity</p>
		</div>
	{:else}
		<div class="flex flex-col flex-1 overflow-y-auto overflow-x-hidden min-w-0">
			{#each entries as entry, i (entry.id)}
				{@const borderColorCls = borderColor(entry)}
				{@const colorCls = actorColor(entry)}
				<a
					href={entry.issue_id
						? `/projects/${entry.project_id}/issues/${entry.issue_id}`
						: `/projects/${entry.project_id}`}
					class="grid grid-cols-[2.5rem_4.5rem_7rem_1fr] gap-2 px-3 py-1 border-l-2 hover:bg-base-hi transition-colors cursor-pointer {borderColorCls} min-w-0"
					style="opacity: {1 - i * 0.03}; animation: terminal-entry-enter 150ms ease-out both; animation-delay: {Math.min(i * 30, 200)}ms"
				>
					<span class="text-muted text-xs font-mono truncate">{formatTime(entry.created_at)}</span>
					<span class="text-xs font-mono font-medium {colorCls} truncate">{actorName(entry)}</span>
					<span class="text-secondary/70 text-xs font-mono truncate">{entry.issue_title || '—'}</span>
					<span class="text-secondary text-xs font-mono truncate">{actionLabel(entry)}</span>
				</a>
			{/each}
		</div>
	{/if}
</div>
