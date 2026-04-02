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

	/** Border color based on actor type for terminal severity indicator */
	function borderColor(actorType: string): string {
		switch (actorType) {
			case 'agent': return 'border-l-cyan';
			case 'user': return 'border-l-green';
			case 'system': return 'border-l-purple';
			default: return 'border-l-muted';
		}
	}

	/** Text color based on actor type */
	function actorColor(actorType: string): string {
		switch (actorType) {
			case 'agent': return 'text-cyan';
			case 'user': return 'text-green';
			case 'system': return 'text-purple';
			default: return 'text-secondary';
		}
	}
</script>

<div class="bg-surface border border-edge rounded-sm flex flex-col h-full">
	<!-- Terminal chrome -->
	<div class="flex items-center gap-2 px-4 py-2.5 border-b border-edge bg-base-hi rounded-t-sm">
		<div class="flex gap-1.5">
			<span class="w-2.5 h-2.5 rounded-full bg-red/70"></span>
			<span class="w-2.5 h-2.5 rounded-full bg-amber/70"></span>
			<span class="w-2.5 h-2.5 rounded-full bg-green/70"></span>
		</div>
		<span class="text-muted text-xs font-mono">mission.log</span>
	</div>

	{#if loading}
		<div class="p-4 space-y-2">
			{#each Array(6) as _}
				<div class="skeleton h-3.5 w-full rounded"></div>
			{/each}
		</div>
	{:else if entries.length === 0}
		<div class="flex-1 flex items-center justify-center py-8 px-4">
			<p class="text-muted text-xs font-mono">No recent activity</p>
		</div>
	{:else}
		<div class="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
			{#each entries as entry, i (entry.id)}
				{@const borderColorCls = borderColor(entry.actor_type)}
				{@const colorCls = actorColor(entry.actor_type)}
				<a
					href={entry.issue_id
						? `/projects/${entry.project_id}/issues/${entry.issue_id}`
						: `/projects/${entry.project_id}`}
					class="flex items-baseline gap-2 px-4 py-1.5 border-l-[3px] hover:bg-base-hi transition-colors cursor-pointer {borderColorCls}"
					style="opacity: {1 - i * 0.04}; animation: terminal-entry-enter 150ms ease-out both; animation-delay: {Math.min(i * 30, 200)}ms"
				>
					<!-- Timestamp -->
					<span class="text-muted text-xs font-mono flex-shrink-0 w-10">[{formatTime(entry.created_at)}]</span>

					<!-- Actor -->
					<span class="text-xs font-mono font-semibold {colorCls} flex-shrink-0 w-16 truncate">{actorName(entry)}</span>

					<!-- Separator -->
					<span class="text-muted text-xs font-mono flex-shrink-0">&gt;</span>

					<!-- Action message -->
					<span class="text-secondary text-xs font-mono truncate flex-1">{actionLabel(entry)}</span>

					<!-- Project name (desktop only) -->
					{#if entry.project_name}
						<span class="hidden md:inline text-muted/50 text-xs font-mono flex-shrink-0 w-24 truncate text-right">{entry.project_name}</span>
					{/if}
				</a>
			{/each}
		</div>

		<!-- Blinking cursor -->
		<div class="px-4 py-2 border-t border-edge">
			<span class="text-cyan font-mono text-xs">$ </span><span class="terminal-cursor"></span>
		</div>
	{/if}
</div>
