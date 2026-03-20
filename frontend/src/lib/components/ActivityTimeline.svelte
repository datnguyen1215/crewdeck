<script lang="ts">
	import type { ActivityLog } from '$lib/api/http.js';
	import { ACTOR_CFG, HANDOFF_ACTIONS, actorName, actionLabel, hasExpandableDetails } from '$lib/activity.js';
	import { relTime } from '$lib/utils/time.js';
	import ActivityDetails from './ActivityDetails.svelte';

	let {
		entries,
		expanded,
		onToggleExpand,
		projectId = undefined,
		issueMap = {},
		showRecentGlow = false,
		compact = false,
		highlightHandoffs = false,
		filterIssue = ''
	}: {
		entries: ActivityLog[];
		expanded: Set<string>;
		onToggleExpand: (id: string) => void;
		projectId?: string;
		issueMap?: Record<string, string>;
		showRecentGlow?: boolean;
		compact?: boolean;
		highlightHandoffs?: boolean;
		filterIssue?: string;
	} = $props();

	function isRecent(dateStr: string): boolean {
		return Date.now() - new Date(dateStr).getTime() < 2 * 3_600_000;
	}

	function shortIssueId(id: string): string {
		return id.slice(0, 8);
	}
</script>

<div class="relative">
	<div class="absolute {compact ? 'left-[9px]' : 'left-[19px]'} top-2 bottom-0 w-px bg-edge pointer-events-none"></div>
	<div class="flex flex-col">
		{#each entries as entry, i (entry.id)}
			{@const cfg = ACTOR_CFG[entry.actor_type] ?? ACTOR_CFG.system}
			{@const details = (entry.details as Record<string, unknown>) ?? {}}
			{@const expandable = hasExpandableDetails(entry)}
			{@const isExp = expanded.has(entry.id)}
			{@const recent = showRecentGlow && isRecent(entry.created_at)}
			{@const handoff = highlightHandoffs && filterIssue && HANDOFF_ACTIONS.has(entry.action)}
			<div
				class="flex {compact ? 'gap-3 pb-4' : 'gap-4 pb-5'} relative {handoff ? 'ml-1 border-l-2 border-purple/30 pl-2' : ''}"
				style="animation: fade-up {compact ? '0.2s' : '0.25s'} ease both; animation-delay: {Math.min(i * (compact ? 25 : 30), compact ? 200 : 300)}ms"
			>
				<!-- Actor dot -->
				<div class="flex-shrink-0 {compact ? 'w-5' : 'w-10'} flex justify-center pt-0.5 relative z-10">
					<div
						class="{compact ? 'w-5 h-5' : 'w-6 h-6'} rounded-full bg-base border flex items-center justify-center {compact ? 'border-edge' : cfg.border}"
						style={recent && cfg.glow ? `box-shadow: ${cfg.glow}` : ''}
					>
						<span class="{compact ? 'text-[9px]' : 'text-[10px]'} leading-none {cfg.color}">{cfg.icon}</span>
					</div>
				</div>

				<!-- Event content -->
				<div class="flex-1 min-w-0 pt-0.5">
					<div class="flex items-center gap-2 mb-0.5 flex-wrap">
						<span class="text-xs font-semibold {cfg.color}">{actorName(entry)}</span>
						<span class="text-muted text-xs font-mono" title={new Date(entry.created_at).toLocaleString()}>
							{relTime(entry.created_at)}
						</span>
					</div>

					<p class="text-secondary text-sm">{actionLabel(entry)}</p>

					<!-- Issue link (activity page only) -->
					{#if projectId && entry.issue_id}
						<a
							href="/projects/{projectId}/issues/{entry.issue_id}"
							class="text-xs text-muted hover:text-cyan transition-colors mt-0.5 inline-block"
							title="#{shortIssueId(entry.issue_id)}"
						>
							{issueMap[entry.issue_id] ?? `#${shortIssueId(entry.issue_id)}`}
						</a>
					{/if}

					<!-- Expandable details -->
					{#if expandable}
						<button
							onclick={() => onToggleExpand(entry.id)}
							class="{compact ? 'mt-1' : 'mt-1.5'} text-xs text-muted hover:text-secondary transition-colors flex items-center gap-1"
						>
							<span class="font-mono text-[10px]">{isExp ? '▾' : '▸'}</span>
							<span>{isExp ? (compact ? 'Hide' : 'Hide details') : (compact ? 'Details' : 'Show details')}</span>
						</button>
						{#if isExp}
							<div class="{compact ? 'mt-1.5 p-2' : 'mt-2 p-2.5'} bg-base-hi border border-edge rounded text-xs text-secondary font-mono leading-relaxed">
								<ActivityDetails {details} />
							</div>
						{/if}
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>
