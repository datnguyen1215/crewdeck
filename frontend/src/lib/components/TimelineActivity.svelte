<script lang="ts">
	import type { ActivityLog, AgentRun, AgentRunEvent } from '$lib/api/http.js';
	import { smartTime, fullTime } from '$lib/utils/time.js';
	import { ACTOR_CFG, actorName, actionLabel, hasExpandableDetails } from '$lib/activity.js';
	import { RUN_STATUS_DOT, RUN_STATUS_CFG } from '$lib/config/status.js';
	import ActivityDetails from './ActivityDetails.svelte';
	import { formatDuration, formatCost } from '$lib/utils/format.js';
	import { renderEventContent } from '$lib/utils/event.js';

	let {
		entry,
		index,
		activityExpanded,
		expandedRun,
		expandedEvents,
		loadingEvents,
		matchedRun,
		spawnedRun,
		onToggleActivityExpand,
		onToggleRunExpand,
		onOpenRunModal
	}: {
		entry: ActivityLog;
		index: number;
		activityExpanded: Set<string>;
		expandedRun: string | null;
		expandedEvents: AgentRunEvent[];
		loadingEvents: boolean;
		matchedRun: AgentRun | undefined;
		spawnedRun: AgentRun | undefined;
		onToggleActivityExpand: (id: string) => void;
		onToggleRunExpand: (runId: string) => void;
		onOpenRunModal: (run: AgentRun) => void;
	} = $props();

	const cfg = $derived(ACTOR_CFG[entry.actor_type] ?? ACTOR_CFG.system);
	const expandable = $derived(hasExpandableDetails(entry));
	const isExp = $derived(activityExpanded.has(entry.id));
</script>

<div
	class="flex gap-3 pb-4 relative"
	style="animation: fade-up 0.2s ease both; animation-delay: {Math.min(index * 25, 200)}ms"
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
			<span class="text-muted text-xs font-mono" title={fullTime(entry.created_at)}>
				{smartTime(entry.created_at)}
			</span>
		</div>

		<p class="text-secondary text-sm">{actionLabel(entry)}</p>

		{#if spawnedRun}
			<button
				onclick={() => onOpenRunModal(spawnedRun!)}
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
					onclick={() => onToggleRunExpand(matchedRun!.id)}
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
				onclick={() => onToggleActivityExpand(entry.id)}
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
