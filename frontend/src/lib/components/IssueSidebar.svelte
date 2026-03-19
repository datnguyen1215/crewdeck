<script lang="ts">
	import { goto } from '$app/navigation';
	import { approveIssue, discardIssue, type IssueWithDetails } from '$lib/api/http.js';
	import { relTime } from '$lib/utils/time.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';

	let {
		issue,
		projectId,
		onApprove,
		onEdit
	}: {
		issue: IssueWithDetails;
		projectId: string;
		onApprove: () => void;
		onEdit: () => void;
	} = $props();

	let showApproveConfirm = $state(false);
	let showDiscardConfirm = $state(false);
	let working = $state(false);
	let copied = $state(false);

	const STATUS_CFG: Record<
		string,
		{ label: string; dot: string; text: string; border: string; glow?: string; pulse?: boolean; dashed?: boolean }
	> = {
		draft: { label: 'Draft', dot: '\u25CC', text: 'text-muted', border: 'border-muted', dashed: true },
		open: { label: 'Open', dot: '\u25CB', text: 'text-blue', border: 'border-blue', glow: 'var(--glow-blue)' },
		in_progress: { label: 'In Progress', dot: '\u25C9', text: 'text-green', border: 'border-green', glow: 'var(--glow-green)', pulse: true },
		in_review: { label: 'In Review', dot: '\u25C9', text: 'text-amber', border: 'border-amber', glow: 'var(--glow-amber)' },
		feedback: { label: 'Feedback', dot: '\u25C9', text: 'text-red', border: 'border-red', glow: 'var(--glow-red)' },
		ready: { label: 'Ready', dot: '\u25CF', text: 'text-green', border: 'border-green', glow: 'var(--glow-green)' },
		pr_created: { label: 'PR Created', dot: '\u25C9', text: 'text-purple', border: 'border-purple', glow: 'var(--glow-purple)' },
		done: { label: 'Done', dot: '\u2713', text: 'text-secondary', border: 'border-secondary' }
	};

	const PR_STATUS: Record<string, string> = {
		open: 'text-green border-green',
		merged: 'text-purple border-purple',
		closed: 'text-red border-red'
	};

	function agentStatusIcon(status: string, role: string) {
		if (status === 'active') return { icon: '\u25C9', cls: role === 'worker' ? 'text-green' : 'text-cyan', pulse: true };
		if (status === 'done') return { icon: '\u25C9', cls: 'text-green', pulse: false };
		if (status === 'approved') return { icon: '\u2713', cls: 'text-green', pulse: false };
		if (status === 'changes_requested') return { icon: '\u26A0', cls: 'text-amber', pulse: false };
		return { icon: '\u25CC', cls: 'text-muted', pulse: false };
	}

	async function handleApprove() {
		working = true;
		try {
			await approveIssue(projectId, issue.id);
			showApproveConfirm = false;
			onApprove();
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to approve issue', 'error');
		} finally {
			working = false;
		}
	}

	async function handleDiscard() {
		working = true;
		try {
			await discardIssue(projectId, issue.id);
			goto(`/projects/${projectId}`);
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to discard issue', 'error');
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
					class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border {cfg.text} {cfg.border} {cfg.dashed ? 'border-dashed' : ''}"
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

		<!-- Agent -->
		<div class="flex items-center gap-2">
			<span class="text-muted w-20 shrink-0">Agent</span>
			{#if issue.assigned_agent}
				<a href="/projects/{projectId}/crew" class="text-cyan hover:underline">{issue.assigned_agent.name}</a>
			{:else}
				<span class="text-muted">—</span>
			{/if}
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

		<!-- Worktree (collapsed) -->
		{#if issue.worktree_path}
			<details>
				<summary class="text-muted cursor-pointer hover:text-secondary flex items-center gap-2 list-none">
					<span class="w-20 shrink-0">Worktree</span>
					<span class="font-mono text-muted truncate">{'\u2026'}/{issue.worktree_path.split('/').pop()}</span>
				</summary>
				<div class="mt-1 ml-[5.5rem] font-mono text-muted break-all text-xs">{issue.worktree_path}</div>
			</details>
		{/if}

		<!-- Review round -->
		{#if issue.max_review_rounds}
			<div class="flex items-center gap-2">
				<span class="text-muted w-20 shrink-0">Review</span>
				<span class="text-secondary">Round {issue.current_review_round} of {issue.max_review_rounds}</span>
			</div>
		{/if}

		<!-- Timestamps -->
		<div class="flex items-center gap-2">
			<span class="text-muted w-20 shrink-0">Created</span>
			<span class="text-secondary" title={new Date(issue.created_at).toLocaleString()}>{relTime(issue.created_at)}</span>
		</div>
		<div class="flex items-center gap-2">
			<span class="text-muted w-20 shrink-0">Updated</span>
			<span class="text-secondary" title={new Date(issue.updated_at).toLocaleString()}>{relTime(issue.updated_at)}</span>
		</div>

		<!-- Created by -->
		<div class="flex items-center gap-2">
			<span class="text-muted w-20 shrink-0">By</span>
			<span class="{issue.created_by === 'orchestrator' || issue.created_by === 'captain' ? 'text-purple' : 'text-secondary'}">{issue.created_by === 'orchestrator' || issue.created_by === 'captain' ? 'Captain' : issue.created_by}</span>
		</div>
	</div>

	<!-- Actions -->
	<div class="bg-surface border border-edge rounded p-4">
		<div class="text-xs text-muted uppercase tracking-widest mb-3">Actions</div>
		<div class="flex flex-col gap-2 text-xs">
			{#if issue.status === 'draft'}
				{#if showApproveConfirm}
					<div class="bg-base border border-green/30 rounded p-3 text-secondary">
						Approve this draft and open it as an active issue?
						<div class="flex gap-2 mt-2">
							<button onclick={handleApprove} disabled={working} class="px-2 py-1 border border-green text-green rounded hover:bg-green/10 disabled:opacity-50 transition-colors">Confirm</button>
							<button onclick={() => showApproveConfirm = false} class="px-2 py-1 border border-edge text-muted rounded hover:text-secondary transition-colors">Cancel</button>
						</div>
					</div>
				{:else}
					<button onclick={() => showApproveConfirm = true} class="w-full py-1.5 border border-green text-green rounded hover:bg-green/10 transition-colors text-left px-3">Approve Draft</button>
				{/if}

				{#if showDiscardConfirm}
					<div class="bg-base border border-red/30 rounded p-3 text-secondary">
						Discard this draft permanently? This cannot be undone.
						<div class="flex gap-2 mt-2">
							<button onclick={handleDiscard} disabled={working} class="px-2 py-1 border border-red text-red rounded hover:bg-red/10 disabled:opacity-50 transition-colors">Discard</button>
							<button onclick={() => showDiscardConfirm = false} class="px-2 py-1 border border-edge text-muted rounded hover:text-secondary transition-colors">Cancel</button>
						</div>
					</div>
				{:else}
					<button onclick={() => showDiscardConfirm = true} class="w-full py-1.5 border border-red/40 text-red/60 rounded hover:bg-red/10 hover:border-red hover:text-red transition-colors text-left px-3">Discard Draft</button>
				{/if}
			{/if}

			{#if issue.status === 'ready'}
				<button disabled class="w-full py-1.5 border border-cyan/40 text-cyan/40 rounded text-left px-3 cursor-not-allowed">Create PR</button>
			{/if}

			<!-- Decision: pr_url is not scheme-validated (e.g. startsWith('https://'))
				 because it comes from our own backend which only stores GitHub URLs.
				 Adding a guard would be over-engineering for an internal tool with trusted data. -->
			{#if issue.status === 'pr_created' && issue.issue_prs?.length}
				{@const pr = issue.issue_prs[0]}
				<a href={pr.pr_url} target="_blank" rel="noopener" class="w-full py-1.5 border border-purple text-purple rounded hover:bg-purple/10 transition-colors text-left px-3 block">View PR #{pr.pr_number}</a>
			{/if}

			<button onclick={onEdit} class="w-full py-1.5 border border-edge text-secondary rounded hover:border-edge-hi hover:text-primary transition-colors text-left px-3">Edit Issue</button>
		</div>
	</div>

	<!-- Agents panel -->
	{#if issue.issue_agents?.length}
		<div class="bg-surface border border-edge rounded p-4">
			<div class="text-xs text-muted uppercase tracking-widest mb-3">Agents</div>
			<div class="flex flex-col gap-2 text-xs">
				{#each [...issue.issue_agents].sort((a, b) => a.role === 'worker' ? -1 : b.role === 'worker' ? 1 : (a.review_order ?? 0) - (b.review_order ?? 0)) as ia}
					{@const s = agentStatusIcon(ia.status, ia.role)}
					<div class="flex items-center gap-2">
						<span class="text-muted w-16 shrink-0">
							{ia.role === 'worker' ? 'Worker' : `Rev ${ia.review_order}`}
						</span>
						{#if ia.agent}
							<span class="text-secondary">{ia.agent.name}</span>
						{:else}
							<span class="text-muted">—</span>
						{/if}
						<span class="ml-auto {s.cls} {s.pulse ? 'animate-pulse' : ''}">{s.icon}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Pull Requests panel -->
	<!-- See decision comment above re: pr_url scheme validation -->
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
