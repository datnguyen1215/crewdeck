<script lang="ts">
	import type { IssueWithDetails } from '$lib/api/http.js';

	let {
		issue,
		working,
		onPauseResume,
		onMarkPrCreated,
		onMarkDone,
		onResetChainDepth,
		onMergePR,
		onEdit,
		onDelete
	}: {
		issue: IssueWithDetails;
		working: boolean;
		onPauseResume: () => void;
		onMarkPrCreated: () => void;
		onMarkDone: () => void;
		onResetChainDepth: () => void;
		onMergePR: () => void;
		onEdit: () => void;
		onDelete: () => void;
	} = $props();
</script>

<div class="bg-surface border border-edge rounded p-4">
	<div class="text-xs text-muted uppercase tracking-widest mb-3">Actions</div>
	<div class="flex flex-col gap-2 text-xs">
		{#if issue.status !== 'done'}
			<button onclick={onPauseResume} disabled={working} class="w-full py-2.5 sm:py-1.5 border border-amber text-amber rounded hover:bg-amber/10 transition-colors text-left px-3 disabled:opacity-50 min-h-[44px] sm:min-h-0 flex items-center gap-2">
				<span>{issue.paused ? '▶️' : '⏸️'}</span>
				<span>{issue.paused ? 'Resume' : 'Pause'}</span>
			</button>
		{/if}

		{#if issue.status === 'in_progress'}
			<button onclick={onMarkPrCreated} disabled={working} class="w-full py-2.5 sm:py-1.5 border border-purple text-purple rounded hover:bg-purple/10 transition-colors text-left px-3 disabled:opacity-50 min-h-[44px] sm:min-h-0">Mark as PR Created</button>
		{/if}

		{#if issue.status !== 'done'}
			<button onclick={onMarkDone} disabled={working} class="w-full py-2.5 sm:py-1.5 border border-green text-green rounded hover:bg-green/10 transition-colors text-left px-3 disabled:opacity-50 min-h-[44px] sm:min-h-0">Mark as Done</button>
		{/if}

		{#if issue.chain_depth > 0}
			<button onclick={onResetChainDepth} disabled={working} class="w-full py-2.5 sm:py-1.5 border border-amber text-amber rounded hover:bg-amber/10 transition-colors text-left px-3 disabled:opacity-50 min-h-[44px] sm:min-h-0">Reset Chain Depth ({issue.chain_depth})</button>
		{/if}

		{#if issue.status.startsWith('pr_') && issue.issue_prs?.length}
			{@const pr = issue.issue_prs[0]}
			<a href={pr.pr_url} target="_blank" rel="noopener" class="w-full py-2.5 sm:py-1.5 border border-purple text-purple rounded hover:bg-purple/10 transition-colors text-left px-3 block min-h-[44px] sm:min-h-0 flex items-center">View PR #{pr.pr_number}</a>
			<button onclick={onMergePR} disabled={working} class="w-full py-2.5 sm:py-1.5 border border-cyan text-cyan rounded hover:bg-cyan/10 transition-colors text-left px-3 disabled:opacity-50 min-h-[44px] sm:min-h-0">Merge PR</button>
		{/if}

		<button onclick={onEdit} class="w-full py-2.5 sm:py-1.5 border border-edge text-secondary rounded hover:border-edge-hi hover:text-primary transition-colors text-left px-3 min-h-[44px] sm:min-h-0">Edit Issue</button>

		<button onclick={onDelete} class="w-full py-2.5 sm:py-1.5 border border-red/50 text-red/50 rounded hover:border-red hover:text-red transition-colors text-left px-3 min-h-[44px] sm:min-h-0">Delete Issue</button>
	</div>
</div>
