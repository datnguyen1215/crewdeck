<script lang="ts">
	import type { ActivityLog } from '$lib/api/http.js';
	import { ACTOR_CFG, actionLabel, actorName } from '$lib/activity.js';
	import { smartTimeDiff, fullTime } from '$lib/utils/time.js';

	let {
		entries,
		loading
	}: {
		entries: ActivityLog[];
		loading: boolean;
	} = $props();
</script>

<div class="bg-surface border border-edge rounded-lg p-5 flex flex-col h-full">
	<h2 class="text-xs font-bold text-muted uppercase tracking-widest mb-4">RECENT ACTIVITY</h2>

	{#if loading}
		<div class="flex flex-col gap-3">
			{#each Array(5) as _}
				<div class="flex gap-3">
					<div class="skeleton w-5 h-5 rounded-full flex-shrink-0"></div>
					<div class="flex-1">
						<div class="skeleton h-3 w-20 rounded mb-1.5"></div>
						<div class="skeleton h-3 w-40 rounded mb-1"></div>
						<div class="skeleton h-2.5 w-14 rounded"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else if entries.length === 0}
		<div class="flex-1 flex items-center justify-center py-8">
			<p class="text-muted text-sm">No recent activity</p>
		</div>
	{:else}
		<div class="flex flex-col gap-3 flex-1 overflow-auto">
			{#each entries as entry, i (entry.id)}
				{@const cfg = ACTOR_CFG[entry.actor_type] ?? ACTOR_CFG.system}
				<a
					href={entry.issue_id
						? `/projects/${entry.project_id}/issues/${entry.issue_id}`
						: `/projects/${entry.project_id}`}
					class="flex gap-3 group cursor-pointer rounded-md px-1 -mx-1 py-1 hover:bg-base-hi transition-colors"
					style="animation: fade-up 0.25s ease both; animation-delay: {Math.min(i * 30, 200)}ms"
				>
					<!-- Actor dot -->
					<div class="w-5 h-5 rounded-full bg-base border border-edge flex items-center justify-center flex-shrink-0 mt-0.5">
						<span class="text-[9px] leading-none {cfg.color}">{cfg.icon}</span>
					</div>

					<!-- Content -->
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2 mb-0.5">
							<span class="text-xs font-semibold {cfg.color}">{actorName(entry)}</span>
							<span class="text-muted text-xs font-mono" title={fullTime(entry.created_at)}>
								{smartTimeDiff(entry.created_at)}
							</span>
						</div>
						<p class="text-secondary text-sm truncate">{actionLabel(entry)}</p>
						{#if entry.issue_title}
							<p class="text-muted text-xs truncate mt-0.5">{entry.issue_title}</p>
						{/if}
						{#if entry.project_name}
							<span class="text-xs text-muted/60 group-hover:text-muted transition-colors">{entry.project_name}</span>
						{/if}
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>
