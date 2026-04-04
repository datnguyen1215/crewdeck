<script lang="ts">
	import { goto } from '$app/navigation';
	import { getContext } from 'svelte';
	import { STATUS_CFG } from '$lib/config/status.js';
	import { smartTimeDiff, fullTime } from '$lib/utils/time.js';
	import type { IssueWithRunningAgent, Project } from '$lib/api/http.js';

	const getProjectId = getContext<() => string>('projectId');
	const getProject = getContext<() => Project | null>('project');

	let {
		issue,
		agentMap,
		visibleColumns,
		gridCols,
		isDispatching,
		ondispatch,
		index = 0,
	}: {
		issue: IssueWithRunningAgent;
		agentMap: Record<string, string>;
		visibleColumns: string[];
		gridCols: string;
		isDispatching: boolean;
		ondispatch: (e: MouseEvent, issue: IssueWithRunningAgent) => void;
		index?: number;
	} = $props();

	const projectId = $derived(getProjectId());
	const project = $derived(getProject());

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
	class="issue-row grid border-b border-edge last:border-0 hover:bg-surface-hi transition-colors group cursor-pointer {index % 2 === 1 ? 'bg-base-hi' : 'bg-base'} {issue.status === 'in_progress' ? 'in-progress-row' : ''} {issue.paused ? 'opacity-60' : ''}"
	style="grid-template-columns: {gridCols}; animation: fade-up 0.25s ease both; animation-delay: {index * 25}ms"
>
	<!-- Title -->
	{#if visibleColumns.includes('title')}
	<div class="px-3 py-3 self-center min-w-0">
		<p class="text-primary text-sm truncate group-hover:text-cyan transition-colors flex items-center gap-2">
			{#if issue.paused}
				<span class="text-amber flex-shrink-0" title="Paused">⏸️</span>
			{/if}
			{issue.title}
		</p>
		{#if issue.created_by === 'agent'}
			<p class="text-muted text-xs mt-0.5">proposed by agent</p>
		{/if}
		{#if issue.dependencies.length > 0}
			<div class="flex flex-wrap gap-1 mt-1">
				{#each issue.dependencies as dep}
					{@const depCfg = STATUS_CFG[dep.status] ?? STATUS_CFG.open}
					<button
						onclick={(e) => { e.stopPropagation(); goto(`/projects/${projectId}/issues/${dep.id}`); }}
						class="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border border-edge text-muted hover:border-edge-hi hover:text-secondary transition-colors max-w-[180px]"
						title="Depends on: {dep.title}"
					>
						<span class="leading-none flex-shrink-0">{depCfg.dot}</span>
						<span class="truncate">{dep.title}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
	{/if}

	<!-- Status badge -->
	{#if visibleColumns.includes('status')}
	<div class="px-3 py-3 self-center">
		<span
			class="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border {cfg.text} {cfg.border} {cfg.pulse ? 'badge-pulse' : ''}"
			style={cfg.glow ? `box-shadow: ${cfg.glow}` : ''}
		>
			<span class="leading-none">{cfg.dot}</span>
			{cfg.label}
		</span>
	</div>
	{/if}

	<!-- Agent -->
	{#if visibleColumns.includes('agent')}
	<div class="px-3 py-3 self-center">
		{#if runningAgentName}
			<span class="text-sm truncate block {isQueued ? 'text-muted' : 'text-cyan'}">
				{runningAgentName}
			</span>
		{:else}
			<span class="text-sm text-muted truncate block">—</span>
		{/if}
	</div>
	{/if}

	<!-- Base branch (optional column) -->
	{#if visibleColumns.includes('baseBranch')}
	<div class="px-3 py-3 self-center">
		<span class="text-xs font-mono text-muted truncate block">{issue.base_branch ?? (project?.default_base_branch ?? 'main')}</span>
	</div>
	{/if}

	<!-- Age -->
	{#if visibleColumns.includes('age')}
	<div class="px-3 py-3 self-center text-right">
		<span class="text-xs text-muted font-mono" title={fullTime(issue.created_at)}>
			{smartTimeDiff(issue.created_at)}
		</span>
	</div>
	{/if}

	<!-- Updated -->
	{#if visibleColumns.includes('updated')}
	<div class="px-3 py-3 self-center text-right">
		<span class="text-xs text-muted font-mono" title={fullTime(issue.updated_at)}>
			{smartTimeDiff(issue.updated_at)}
		</span>
	</div>
	{/if}

	<!-- Dispatch button -->
	{#if visibleColumns.includes('dispatch')}
	<div class="px-2 py-3 self-center">
		<button
			onclick={(e) => ondispatch(e, issue)}
			disabled={!canDispatch}
			class="dispatch-btn w-7 h-7 flex items-center justify-center rounded border transition-colors {canDispatch ? 'border-edge text-muted hover:border-cyan hover:text-cyan hover:bg-cyan/10' : 'border-transparent text-muted/40 cursor-not-allowed'}"
			title={hasActiveAgent ? 'Agent already running' : 'Start work'}
		>
			{#if isDispatching}
				<svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
					<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="32" stroke-dashoffset="12" />
				</svg>
			{:else}
				<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
					<path d="M8 5v14l11-7z"/>
				</svg>
			{/if}
		</button>
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

	.in-progress-row {
		box-shadow: inset 3px 0 0 rgba(74, 222, 128, 0.4);
	}
</style>
