<script lang="ts">
	import { goto } from '$app/navigation';
	import { updateIssue, deleteIssue, type IssueWithDetails } from '$lib/api/http.js';
	import { relTime, parseUTC } from '$lib/utils/time.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';

	let {
		issue,
		projectId,
		onStatusChange,
		onEdit
	}: {
		issue: IssueWithDetails;
		projectId: string;
		onStatusChange: () => void;
		onEdit: () => void;
	} = $props();

	let working = $state(false);
	let copied = $state(false);
	let confirmingDelete = $state(false);

	const STATUS_CFG: Record<
		string,
		{ label: string; dot: string; text: string; border: string; glow?: string; pulse?: boolean }
	> = {
		open: { label: 'Open', dot: '\u25CB', text: 'text-blue', border: 'border-blue', glow: 'var(--glow-blue)' },
		in_progress: { label: 'In Progress', dot: '\u25C9', text: 'text-green', border: 'border-green', glow: 'var(--glow-green)', pulse: true },
		pr_created: { label: 'PR Created', dot: '\u25C9', text: 'text-purple', border: 'border-purple', glow: 'var(--glow-purple)' },
		done: { label: 'Done', dot: '\u2713', text: 'text-secondary', border: 'border-secondary' }
	};

	const PR_STATUS: Record<string, string> = {
		open: 'text-green border-green',
		merged: 'text-purple border-purple',
		closed: 'text-red border-red'
	};

	async function handleMarkPrCreated() {
		working = true;
		try {
			await updateIssue(projectId, issue.id, { status: 'pr_created' });
			onStatusChange();
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to mark PR created', 'error');
		} finally {
			working = false;
		}
	}

	async function handleMarkDone() {
		working = true;
		try {
			await updateIssue(projectId, issue.id, { status: 'done' });
			onStatusChange();
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to mark as done', 'error');
		} finally {
			working = false;
		}
	}

	async function handleResetChainDepth() {
		working = true;
		try {
			await updateIssue(projectId, issue.id, { chain_depth: 0 });
			onStatusChange();
			toastStore.add('Chain depth reset', 'success');
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to reset chain depth', 'error');
		} finally {
			working = false;
		}
	}

	async function copyBranch() {
		if (!issue?.branch_name) return;
		await navigator.clipboard.writeText(issue.branch_name);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<div class="flex flex-col gap-4">
	<!-- Metadata -->
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

		<!-- Priority -->
		<div class="flex items-center gap-2">
			<span class="text-muted w-20 shrink-0">Priority</span>
			<span class="font-bold {issue.priority >= 8 ? 'text-amber' : issue.priority >= 5 ? 'text-blue' : 'text-secondary'}">
				{issue.priority}
			</span>
		</div>

		<!-- Chain depth -->
		<div class="flex items-center gap-2">
			<span class="text-muted w-20 shrink-0">Chain</span>
			<span class="text-secondary">{issue.chain_depth} / 20</span>
		</div>

		<!-- Branch -->
		{#if issue.branch_name}
			<div class="flex items-start gap-2">
				<span class="text-muted w-20 shrink-0 pt-px">Branch</span>
				<button
					onclick={copyBranch}
					class="font-mono text-secondary hover:text-primary transition-colors text-left leading-tight break-all"
					title="Click to copy"
				>
					{issue.branch_name}
					<span class="ml-1 text-muted">{copied ? '\u2713' : '\u2398'}</span>
				</button>
			</div>
		{/if}

		<!-- Base branch -->
		{#if issue.base_branch}
			<div class="flex items-center gap-2">
				<span class="text-muted w-20 shrink-0">Base</span>
				<span class="font-mono text-secondary">{issue.base_branch}</span>
			</div>
		{/if}

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
			<span class="text-secondary" title={parseUTC(issue.created_at).toLocaleString()}>{relTime(issue.created_at)}</span>
		</div>
		<div class="flex items-center gap-2">
			<span class="text-muted w-20 shrink-0">Updated</span>
			<span class="text-secondary" title={parseUTC(issue.updated_at).toLocaleString()}>{relTime(issue.updated_at)}</span>
		</div>

		<!-- Created by -->
		<div class="flex items-center gap-2">
			<span class="text-muted w-20 shrink-0">By</span>
			<span class="text-secondary">{issue.created_by}</span>
		</div>
	</div>

	<!-- Actions -->
	<div class="bg-surface border border-edge rounded p-4">
		<div class="text-xs text-muted uppercase tracking-widest mb-3">Actions</div>
		<div class="flex flex-col gap-2 text-xs">
			{#if issue.status === 'in_progress'}
				<button onclick={handleMarkPrCreated} disabled={working} class="w-full py-1.5 border border-purple text-purple rounded hover:bg-purple/10 transition-colors text-left px-3 disabled:opacity-50">Mark as PR Created</button>
			{/if}

			{#if issue.status !== 'done'}
				<button onclick={handleMarkDone} disabled={working} class="w-full py-1.5 border border-green text-green rounded hover:bg-green/10 transition-colors text-left px-3 disabled:opacity-50">Mark as Done</button>
			{/if}

			{#if issue.chain_depth > 0}
				<button onclick={handleResetChainDepth} disabled={working} class="w-full py-1.5 border border-amber text-amber rounded hover:bg-amber/10 transition-colors text-left px-3 disabled:opacity-50">Reset Chain Depth ({issue.chain_depth})</button>
			{/if}

			{#if issue.status === 'pr_created' && issue.issue_prs?.length}
				{@const pr = issue.issue_prs[0]}
				<a href={pr.pr_url} target="_blank" rel="noopener" class="w-full py-1.5 border border-purple text-purple rounded hover:bg-purple/10 transition-colors text-left px-3 block">View PR #{pr.pr_number}</a>
			{/if}

			<button onclick={onEdit} class="w-full py-1.5 border border-edge text-secondary rounded hover:border-edge-hi hover:text-primary transition-colors text-left px-3">Edit Issue</button>

			{#if confirmingDelete}
				<div class="flex gap-2">
					<button
						onclick={async () => {
							working = true;
							try {
								await deleteIssue(projectId, issue.id);
								goto(`/projects/${projectId}`);
							} catch (err) {
								toastStore.add(err instanceof Error ? err.message : 'Failed to delete issue', 'error');
								confirmingDelete = false;
							} finally {
								working = false;
							}
						}}
						disabled={working}
						class="flex-1 py-1.5 border border-red text-red rounded hover:bg-red/10 transition-colors px-3 disabled:opacity-50"
					>Confirm</button>
					<button onclick={() => confirmingDelete = false} class="flex-1 py-1.5 border border-edge text-muted rounded hover:text-secondary transition-colors px-3">Cancel</button>
				</div>
			{:else}
				<button onclick={() => confirmingDelete = true} class="w-full py-1.5 border border-red/50 text-red/50 rounded hover:border-red hover:text-red transition-colors text-left px-3">Delete Issue</button>
			{/if}
		</div>
	</div>

	<!-- Pull Requests panel -->
	<div class="bg-surface border border-edge rounded p-4">
		<div class="text-xs text-muted uppercase tracking-widest mb-3">Pull Requests</div>
		{#if issue.issue_prs?.length}
			<div class="flex flex-col gap-2 text-xs">
				{#each issue.issue_prs as pr}
					<div class="flex items-center gap-2">
						<a href={pr.pr_url} target="_blank" rel="noopener" class="text-cyan hover:underline">PR #{pr.pr_number}</a>
						<span class="px-1.5 py-0.5 rounded border {PR_STATUS[pr.status] ?? 'text-secondary border-edge'}">{pr.status}</span>
					</div>
				{/each}
			</div>
		{:else}
			<p class="text-xs text-muted">No pull requests yet.</p>
		{/if}
	</div>
</div>
