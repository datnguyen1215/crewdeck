<script lang="ts">
	import { goto } from '$app/navigation';
	import { STATUS_CFG } from '$lib/config/status.js';
	import { smartTimeDiff, fullTime } from '$lib/utils/time.js';
	import type { IssueWithRunningAgent, Project } from '$lib/api/http.js';

	let {
		issue,
		projectId,
		agentMap,
		visibleColumns,
		project,
		isDispatching,
		ondispatch,
		animationDelay = 0,
	}: {
		issue: IssueWithRunningAgent;
		projectId: string;
		agentMap: Record<string, string>;
		visibleColumns: string[];
		project: Project | null;
		isDispatching: boolean;
		ondispatch: (e: MouseEvent, issue: IssueWithRunningAgent) => void;
		animationDelay?: number;
	} = $props();

	const cfg = $derived(STATUS_CFG[issue.status] ?? STATUS_CFG.open);
	const runningAgentName = $derived(issue.running_agent_id ? agentMap[issue.running_agent_id] : null);
	const isQueued = $derived(issue.running_agent_status === 'queued');
	const hasActiveAgent = $derived(issue.running_agent_status === 'running' || issue.running_agent_status === 'queued');
	const canDispatch = $derived(!hasActiveAgent && !isDispatching);
</script>

<div
	role="link"
	tabindex="0"
	onclick={(e) => { if ((e.target as HTMLElement).closest('button')) return; goto(`/projects/${projectId}/issues/${issue.id}`); }}
	onkeydown={(e) => e.key === 'Enter' && goto(`/projects/${projectId}/issues/${issue.id}`)}
	class="block bg-surface border border-edge rounded-lg p-4 hover:bg-surface-hi hover:border-edge-hi transition-colors active:scale-[0.99] cursor-pointer {issue.status === 'in_progress' ? 'border-l-green border-l-2' : ''} {issue.paused ? 'opacity-60' : ''}"
	style="animation: fade-up 0.25s ease both; animation-delay: {animationDelay}ms"
>
	<div class="flex items-start justify-between gap-3 mb-3">
		<p class="text-primary text-sm font-medium leading-snug flex-1 min-w-0 flex items-center gap-2">
			{#if issue.paused}
				<span class="text-amber" title="Paused">⏸️</span>
			{/if}
			{issue.title}
		</p>
		<button
			onclick={(e) => ondispatch(e, issue)}
			disabled={!canDispatch}
			class="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg border transition-colors {canDispatch ? 'border-edge text-muted hover:border-cyan hover:text-cyan hover:bg-cyan/10 active:bg-cyan/20' : 'border-transparent text-muted/40 cursor-not-allowed'}"
			title={hasActiveAgent ? 'Agent already running' : 'Start work'}
		>
			{#if isDispatching}
				<svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
					<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="32" stroke-dashoffset="12" />
				</svg>
			{:else}
				<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
					<path d="M8 5v14l11-7z"/>
				</svg>
			{/if}
		</button>
	</div>
	<div class="flex items-center gap-3 flex-wrap">
		<span
			class="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border {cfg.text} {cfg.border} {cfg.pulse ? 'badge-pulse' : ''}"
			style={cfg.glow ? `box-shadow: ${cfg.glow}` : ''}
		>
			<span class="leading-none">{cfg.dot}</span>
			{cfg.label}
		</span>
		{#if runningAgentName && visibleColumns.includes('agent')}
			<span class="text-xs {isQueued ? 'text-muted' : 'text-cyan'}">
				{runningAgentName}
			</span>
		{/if}
		{#if visibleColumns.includes('updated')}
			<span class="text-xs text-muted font-mono ml-auto" title={fullTime(issue.updated_at)}>
				{smartTimeDiff(issue.updated_at)}
			</span>
		{:else if visibleColumns.includes('age')}
			<span class="text-xs text-muted font-mono ml-auto" title={fullTime(issue.created_at)}>
				{smartTimeDiff(issue.created_at)}
			</span>
		{/if}
	</div>
	{#if issue.created_by === 'agent'}
		<p class="text-muted text-xs mt-2">proposed by agent</p>
	{/if}
	{#if visibleColumns.includes('baseBranch')}
		<p class="text-muted text-xs mt-1 font-mono">→ {issue.base_branch ?? (project?.default_base_branch ?? 'main')}</p>
	{/if}
	{#if issue.dependencies.length > 0}
		<div class="flex flex-wrap gap-1 mt-2">
			{#each issue.dependencies as dep}
				{@const depCfg = STATUS_CFG[dep.status] ?? STATUS_CFG.open}
				<button
					onclick={(e) => { e.stopPropagation(); goto(`/projects/${projectId}/issues/${dep.id}`); }}
					class="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border border-edge text-muted hover:border-edge-hi hover:text-secondary transition-colors max-w-[160px]"
					title="Depends on: {dep.title}"
				>
					<span class="leading-none flex-shrink-0">{depCfg.dot}</span>
					<span class="truncate">{dep.title}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.badge-pulse {
		animation: pulse-glow 2s ease-in-out infinite;
	}

	@keyframes pulse-glow {
		0%, 100% { box-shadow: 0 0 6px rgba(74, 222, 128, 0.3); }
		50% { box-shadow: 0 0 14px rgba(74, 222, 128, 0.55); }
	}
</style>
