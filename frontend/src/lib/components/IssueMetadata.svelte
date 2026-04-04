<script lang="ts">
	import type { IssueWithDetails, Project } from '$lib/api/http.js';
	import { smartTime, fullTime } from '$lib/utils/time.js';
	import { STATUS_CFG } from '$lib/config/status.js';

	let {
		issue,
		project,
		globalConfig,
		copied,
		baseBranchEdit = $bindable(''),
		savingBaseBranch,
		isBaseBranchLocked,
		onCopyBranch,
		onSaveBaseBranch,
	}: {
		issue: IssueWithDetails;
		project: Project | null;
		globalConfig: { maxChainDepth: number } | undefined;
		copied: boolean;
		baseBranchEdit: string;
		savingBaseBranch: boolean;
		isBaseBranchLocked: boolean;
		onCopyBranch: () => void;
		onSaveBaseBranch: () => void;
	} = $props();
</script>

<div class="bg-surface border border-edge rounded p-4 flex flex-col gap-2.5 text-xs">
	<!-- Status -->
	{#if STATUS_CFG[issue.status]}
		{@const cfg = STATUS_CFG[issue.status]}
		<div class="flex items-center gap-2">
			<span class="text-muted w-20 shrink-0">Status</span>
			<span
				class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border {cfg.text} {cfg.border}"
				style={cfg.glow ? `box-shadow: ${cfg.glow}` : ''}
			>
				<span class={cfg.pulse ? 'animate-pulse' : ''}>{cfg.dot}</span>
				{cfg.label}
			</span>
		</div>
	{/if}

	<!-- Chain depth -->
	<div class="flex items-center gap-2">
		<span class="text-muted w-20 shrink-0 flex items-center gap-1">
			Chain
			<span class="cursor-help" title="Chain depth tracks how many times an agent has been automatically re-dispatched on this issue. The limit prevents infinite loops.">ℹ</span>
		</span>
		<span class="text-secondary">{issue.chain_depth} / {globalConfig?.maxChainDepth ?? 20}</span>
	</div>

	<!-- Branch -->
	{#if issue.branch_name}
		<div class="flex items-start gap-2">
			<span class="text-muted w-20 shrink-0 pt-px">Branch</span>
			<button
				onclick={onCopyBranch}
				class="font-mono text-secondary hover:text-primary transition-colors text-left leading-tight break-all"
				title="Click to copy"
			>
				{issue.branch_name}
				<span class="ml-1 text-muted">{copied ? '\u2713' : '\u2398'}</span>
			</button>
		</div>
	{/if}

	<!-- Base branch -->
	<div class="flex items-center gap-2">
		<span class="text-muted w-20 shrink-0">Base</span>
		{#if isBaseBranchLocked}
			<span
				class="font-mono text-secondary"
				title="Cannot change base branch after work has started. Rebasing is not yet supported."
			>{issue.base_branch || (project?.default_base_branch ?? 'main')}</span>
		{:else}
			<input
				type="text"
				bind:value={baseBranchEdit}
				placeholder={project?.default_base_branch ?? 'main'}
				disabled={savingBaseBranch}
				onblur={onSaveBaseBranch}
				onkeydown={(e) => e.key === 'Enter' && onSaveBaseBranch()}
				class="font-mono text-secondary bg-transparent border-b border-edge focus:border-cyan outline-none text-xs w-full transition-colors disabled:opacity-50"
			/>
		{/if}
	</div>

	<!-- Worktree -->
	{#if issue.worktree_path}
		<details>
			<summary class="text-muted cursor-pointer hover:text-secondary flex items-center gap-2 list-none">
				<span class="w-20 shrink-0">Worktree</span>
				<span class="font-mono text-muted truncate">{'\u2026'}/{issue.worktree_path.split('/').pop()}</span>
			</summary>
			<div class="mt-1 ml-[5.5rem] font-mono text-muted break-all text-xs">{issue.worktree_path}</div>
		</details>
	{/if}

	<!-- Timestamps -->
	<div class="flex items-center gap-2">
		<span class="text-muted w-20 shrink-0">Created</span>
		<span class="text-secondary" title={fullTime(issue.created_at)}>{smartTime(issue.created_at)}</span>
	</div>
	<div class="flex items-center gap-2">
		<span class="text-muted w-20 shrink-0">Updated</span>
		<span class="text-secondary" title={fullTime(issue.updated_at)}>{smartTime(issue.updated_at)}</span>
	</div>

	<!-- Created by -->
	<div class="flex items-center gap-2">
		<span class="text-muted w-20 shrink-0">By</span>
		<span class="text-secondary">{issue.created_by}</span>
	</div>
</div>
