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
		if (name === 'captain' || name === 'lead') return 'border-l-cyan';
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
		if (name === 'captain' || name === 'lead') return 'text-cyan';
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

<div class="bg-surface border border-edge rounded-sm flex flex-col h-full">
	<!-- Pane header -->
	<div class="flex items-center px-4 py-2 bg-base-hi rounded-t-sm">
		<span class="text-muted text-sm font-mono">mission.log</span>
	</div>

	{#if loading}
		<div class="p-4 space-y-2">
			{#each Array(6) as _}
				<div class="skeleton h-3.5 w-full rounded"></div>
			{/each}
		</div>
	{:else if entries.length === 0}
		<div class="flex-1 flex items-center justify-center py-8 px-4">
			<p class="text-muted text-sm font-mono">No recent activity</p>
		</div>
	{:else}
		<div class="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
			{#each entries as entry, i (entry.id)}
				{@const borderColorCls = borderColor(entry)}
				{@const colorCls = actorColor(entry)}
				<a
					href={entry.issue_id
						? `/projects/${entry.project_id}/issues/${entry.issue_id}`
						: `/projects/${entry.project_id}`}
					class="block px-4 py-1.5 border-l-[3px] hover:bg-base-hi transition-colors cursor-pointer {borderColorCls}"
					style="opacity: {1 - i * 0.04}; animation: terminal-entry-enter 150ms ease-out both; animation-delay: {Math.min(i * 30, 200)}ms"
				>
					<!-- Line 1: Context -->
					<div class="flex items-baseline gap-2">
						<span class="text-muted text-sm font-mono flex-shrink-0">[{formatTime(entry.created_at)}]</span>
						<span class="text-sm font-mono font-semibold {colorCls} flex-shrink-0">{actorName(entry)}</span>
						<span class="text-muted text-sm font-mono flex-shrink-0">&gt;</span>
						{#if entry.project_name}
							<span class="hidden md:inline text-muted/50 text-sm font-mono flex-shrink-0">{entry.project_name}</span>
							<span class="hidden md:inline text-muted text-sm font-mono flex-shrink-0">&gt;</span>
						{/if}
						{#if entry.issue_title}
							<span class="text-secondary text-sm font-mono truncate">{entry.issue_title}</span>
						{/if}
					</div>

					<!-- Line 2: Action -->
					<div class="pl-12 text-secondary text-sm font-mono">
						{actionLabel(entry)}
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>
